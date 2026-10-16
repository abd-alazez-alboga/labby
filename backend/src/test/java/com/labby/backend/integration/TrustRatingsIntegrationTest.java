package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M11-T2 ratings (RATE-01..03, USR-05) through the API on a controlled clock: the 7-day window,
 * once per side, immutability, the caller's own {@code myRating}; lifetime aggregates with the
 * RATE-02 exposure rule (daily snapshot, null below 5 ratings, not moving until the job runs);
 * USR-05 auto-suspension EXACTLY at the thresholds (count min-1 vs min, average at vs below the
 * level, region override) with its notification; the RATE-03 flag; reactivation and re-firing.
 */
class TrustRatingsIntegrationTest extends AbstractTrustIntegrationTest {

  @Test
  @DisplayName("RATE-01: each side rates a completed ride once; myRating and pending follow")
  void shouldRateOnceAndExposeOnlyTheCallersOwnRating() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    Instant completedAt =
        jdbcTemplate.queryForObject(
            "SELECT completed_at FROM rides WHERE ride_id = ?", Instant.class, rideId);

    JsonNode before = riderRide(rider, rideId).get("myRating");
    assertThat(before.get("state").asText()).isEqualTo("pending");
    assertThat(Instant.parse(before.get("windowEndsAt").asText()))
        .isEqualTo(completedAt.plus(Duration.ofDays(7)));
    assertThat(before.get("score").isNull()).isTrue();
    JsonNode riderPending =
        ok(get("/api/v1/ratings/pending?as=rider", rider.token()), HttpStatus.OK);
    assertThat(riderPending).hasSize(1);
    assertThat(riderPending.get(0).get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(riderPending.get(0).get("counterpartFirstName").asText()).isEqualTo("Driver");
    JsonNode driverPending =
        ok(get("/api/v1/ratings/pending?as=driver", driver.token()), HttpStatus.OK);
    assertThat(driverPending.get(0).get("counterpartFirstName").asText()).isEqualTo("Rana");
    assertThat(driverPending.get(0).get("counterpartPhotoUrl").isNull()).isTrue();

    ResponseEntity<JsonNode> stored =
        post(
            "/api/v1/rides/" + rideId + "/rating",
            Map.of("score", 4, "comment", "Smooth"),
            rider.token());
    assertThat(stored.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(stored.getBody()).isNull();
    // Once per side, immutable: a second submission is refused and the stored row is unchanged.
    ResponseEntity<JsonNode> again = rate(rider, rideId, 1);
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("rating_already_submitted");
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT score FROM ratings WHERE ride_id = ? AND rater_role = 'rider'",
                Integer.class,
                rideId))
        .containsExactly(4);

    JsonNode after = riderRide(rider, rideId).get("myRating");
    assertThat(after.get("state").asText()).isEqualTo("submitted");
    assertThat(after.get("score").asInt()).isEqualTo(4);
    assertThat(ok(get("/api/v1/ratings/pending?as=rider", rider.token()), HttpStatus.OK)).isEmpty();
    // The sides are independent: the driver still rates the rider.
    JsonNode driverView = ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK);
    assertThat(driverView.get("myRating").get("state").asText()).isEqualTo("pending");
    rateOk(driver, rideId, 5);
    // Admin views carry no myRating.
    JsonNode adminView = ok(get("/api/v1/admin/rides/" + rideId, admin), HttpStatus.OK);
    assertThat(adminView.get("ride").has("myRating")).isFalse();
  }

  @Test
  @DisplayName("RATE-01: the window closes exactly 7 days after completion (clock-controlled)")
  void shouldCloseTheWindowAfterSevenDays() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID atEdge = completeRide(rider, driver, "cash");
    advance(Duration.ofDays(7));
    rateOk(rider, atEdge, 5); // exactly completedAt + 7 days: still inside

    position(driver, PICKUP_LAT, PICKUP_LNG); // a fresh stream after the 7-day jump
    UUID late = completeRide(rider, driver, "cash");
    advance(Duration.ofDays(7).plusSeconds(1));
    ResponseEntity<JsonNode> closed = rate(rider, late, 5);
    assertThat(closed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(closed)).isEqualTo("rating_window_closed");
    assertThat(riderRide(rider, late).get("myRating").get("state").asText()).isEqualTo("expired");
    assertThat(ok(get("/api/v1/ratings/pending?as=rider", rider.token()), HttpStatus.OK)).isEmpty();
  }

  @Test
  @DisplayName("RATE-01: only a completed ride, only its parties, a valid score")
  void shouldRefuseInvalidRatings() {
    Account rider = newRider();
    Account driver = newDriver();
    Account stranger = newRider();
    UUID accepted =
        ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
    ResponseEntity<JsonNode> notCompleted = rate(rider, accepted, 5);
    assertThat(notCompleted.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(notCompleted)).isEqualTo("ride_not_completed");
    assertThat(riderRide(rider, accepted).get("myRating").get("state").asText())
        .isEqualTo("not_applicable");

    UUID completed = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    assertThat(rate(stranger, completed, 5).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(rate(rider, UUID.randomUUID(), 5).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    for (int score : new int[] {0, 6}) {
      assertThat(rate(rider, completed, score).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
    assertThat(
            post(
                    "/api/v1/rides/" + completed + "/rating",
                    Map.of("score", 3, "comment", "x".repeat(1001)),
                    rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/ratings/pending?as=admin", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ratings", Long.class)).isZero();
  }

  @Test
  @DisplayName(
      "RATE-02: lifetime averages; users see the daily snapshot only from 5 ratings, and it does"
          + " not move until the job runs; admins see the live value")
  void shouldExposeOnlyTheDailySnapshotFromFiveRatings() {
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 3, 5);
    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 4);
    ratingService.refreshSnapshots();

    JsonNode own = ownDriverAggregate(driver);
    assertThat(own.has("ratingCount")).isFalse(); // no count is ever exposed (review B-W1)
    assertThat(own.get("average").isNull()).isTrue(); // 4 ratings: below the exposure minimum
    assertThat(own.get("snapshotAt").isNull()).isFalse();
    assertThat(liveDriverAverage(driver).decimalValue()).isEqualByComparingTo("4.75");

    UUID fifth = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    rateOk(rider, fifth, 3); // 22 / 5 = 4.40 live
    // Not moving until the job runs — the timing side-channel mitigation.
    assertThat(ownDriverAggregate(driver).get("average").isNull()).isTrue();
    assertThat(riderRide(rider, fifth).get("driver").get("rating").isNull()).isTrue();
    assertThat(liveDriverAverage(driver).decimalValue()).isEqualByComparingTo("4.40");

    advance(Duration.ofDays(1));
    ratingService.refreshSnapshots();
    assertThat(ownDriverAggregate(driver).get("average").decimalValue())
        .isEqualByComparingTo("4.40");
    // The counterpart sees the same exposed value in the ride's driver card.
    assertThat(riderRide(rider, fifth).get("driver").get("rating").decimalValue())
        .isEqualByComparingTo("4.40");

    // 33 / 8 = 4.125 -> HALF_UP 4.13 (never the HALF_EVEN 4.12).
    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 4);
    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 4);
    // Review B-W1: fewer than 3 new ratings never rewrite an exposed snapshot.
    ratingService.refreshSnapshots();
    assertThat(ownDriverAggregate(driver).get("average").decimalValue())
        .isEqualByComparingTo("4.40");
    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 3);
    ratingService.refreshSnapshots();
    assertThat(ownDriverAggregate(driver).get("average").decimalValue())
        .isEqualByComparingTo("4.13");
    // Ratings are per role: the driver's rider role has none.
    JsonNode riderRole = ownAggregate(driver, "rider");
    assertThat(riderRole.get("average").isNull()).isTrue();
  }

  @Test
  @DisplayName(
      "USR-05 driver defaults (3.0 after 20): count 19 never suspends; an average of exactly 3.0"
          + " only flags (RATE-03 3.5); just below 3.0 suspends with a notification")
  void shouldAutoSuspendExactlyAtTheDriverThresholds() {
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 18, 3);
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 1);
    // 19 ratings averaging 2.89: below both levels, but one short of the minimum count.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(flags(driver.userId())).isEmpty();

    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 5);
    // 20 ratings averaging exactly 3.00: not below 3.0 (strict), below the 3.5 warning level.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(flags(driver.userId())).hasSize(1);
    Map<String, Object> flag = flags(driver.userId()).get(0);
    assertThat(flag.get("kind")).isEqualTo("low_rating");
    assertThat(flag.get("role")).isEqualTo("driver");
    assertThat((String) flag.get("details"))
        .contains("\"average\": 3.00", "\"ratingCount\": 20", "\"warnAvgRating\": 3.5")
        .contains("\"minRatedRides\": 20", regionId.toString());
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).isEmpty();

    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 2);
    // 62 / 21 = 2.95 < 3.0 — but a rating never suspends by itself (review B-H1): the rater of the
    // ride that just ended would be identified. The daily pass does.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    dailyJob();
    Map<String, Object> role = roleRow(driver.userId(), "driver");
    assertThat(role.get("state")).isEqualTo("suspended");
    assertThat(role.get("suspension_reason")).isEqualTo("low_rating");
    assertThat(role.get("suspension_note")).isNull();
    assertThat(role.get("suspended_at")).isNotNull();
    assertThat(outboxParams(driver.userId(), "account.role_suspended"))
        .singleElement()
        .satisfies(
            params ->
                assertThat(params)
                    .contains("\"role\": \"driver\"", "\"reason\": \"low_rating\"")
                    .contains("\"minAvgRating\": \"3\"", "\"minRatedRides\": 20"));
    assertThat(flags(driver.userId())).hasSize(1); // still one open low_rating flag
    // The rider role is untouched (role-level granularity, USR-04).
    assertThat(roleRow(driver.userId(), "rider").get("state")).isEqualTo("active");
    JsonNode profile = ok(get("/api/v1/users/me", driver.token()), HttpStatus.OK);
    JsonNode driverRole = roleOf(profile, "driver");
    assertThat(driverRole.get("state").asText()).isEqualTo("suspended");
    assertThat(driverRole.get("suspensionReason").asText()).isEqualTo("low_rating");
  }

  @Test
  @DisplayName(
      "USR-05 per region: the region's own driver rule and warning level; rider defaults 2.5"
          + " after 10 with the default 3.0 warning")
  void shouldApplyTheRidesRegionRule() {
    jdbcTemplate.update(
        "UPDATE regions SET suspension_thresholds = CAST(? AS jsonb) WHERE region_id = ?",
        "{\"driver\": {\"minAvgRating\": 4.0, \"minRatedRides\": 5, \"warnAvgRating\": 4.2},"
            + " \"rider\": {\"minAvgRating\": 2.5, \"minRatedRides\": 10}}",
        regionId);
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 4, 4);
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 4);
    // 5 ratings at exactly 4.0: flagged (below 4.2), not suspended.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(flags(driver.userId()))
        .extracting(row -> row.get("kind"))
        .containsExactly("low_rating");
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 3);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");

    Account rider2 = newRider();
    Account driver2 = newDriver();
    riderRatedTimes(rider2, driver2, 9, 3);
    rateAndEvaluate(driver2, completedRide(rider2.userId(), driver2.userId(), CLOCK.instant()), 3);
    assertThat(flags(rider2.userId())).isEmpty(); // exactly 3.0 = the default warning level
    rateAndEvaluate(driver2, completedRide(rider2.userId(), driver2.userId(), CLOCK.instant()), 1);
    assertThat(flags(rider2.userId())).extracting(row -> row.get("role")).containsExactly("rider");
    for (int i = 0; i < 2; i++) {
      rateAndEvaluate(
          driver2, completedRide(rider2.userId(), driver2.userId(), CLOCK.instant()), 1);
    }
    // 33 / 13 = 2.54: still not below 2.5.
    assertThat(roleRow(rider2.userId(), "rider").get("state")).isEqualTo("active");
    rateAndEvaluate(driver2, completedRide(rider2.userId(), driver2.userId(), CLOCK.instant()), 1);
    // 34 / 14 = 2.43 -> the rider role is suspended; booking is refused with the reason.
    assertThat(roleRow(rider2.userId(), "rider").get("suspension_reason")).isEqualTo("low_rating");
    ResponseEntity<JsonNode> booking = tryBook(rider2, booking(List.of()));
    assertThat(booking.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(code(booking)).isEqualTo("rider_suspended");
    assertThat(outboxParams(rider2.userId(), "account.role_suspended"))
        .singleElement()
        .satisfies(params -> assertThat(params).contains("\"minAvgRating\": \"2.5\""));
  }

  @Test
  @DisplayName(
      "USR-05/06: an admin reactivates a rating suspension; the rule fires again only on the next"
          + " rating; a document-expiry suspension is not reactivatable here")
  void shouldReactivateAndReFireOnTheNextRating() {
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 19, 1);
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 1);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");

    JsonNode trust =
        ok(
            post(
                "/api/v1/admin/users/" + driver.userId() + "/roles/driver/reactivate",
                Map.of("note", "Reviewed the complaints"),
                admin),
            HttpStatus.OK);
    JsonNode driverTrust = roleTrust(trust, "driver");
    assertThat(driverTrust.get("state").asText()).isEqualTo("active");
    assertThat(driverTrust.get("suspensionReason").isNull()).isTrue();
    assertThat(driverTrust.get("liveRatingCount").asInt()).isEqualTo(20);
    assertThat(outboxParams(driver.userId(), "account.role_reactivated"))
        .singleElement()
        .satisfies(params -> assertThat(params).contains("Reviewed the complaints"));
    assertThat(auditActions(driver.userId().toString())).contains("user.role_reactivate");
    ResponseEntity<JsonNode> notSuspended =
        post(
            "/api/v1/admin/users/" + driver.userId() + "/roles/driver/reactivate",
            Map.of("note", "again"),
            admin);
    assertThat(notSuspended.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(notSuspended)).isEqualTo("not_suspended");
    // Reactivation itself never re-suspends, nor does the daily pass without a newer rating; the
    // next stored rating does (still below 3.0) at the following pass.
    dailyJob();
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT reactivated_at IS NOT NULL FROM role_assignments WHERE user_id = ? AND"
                    + " role = 'driver'",
                Boolean.class,
                driver.userId()))
        .isTrue();
    advance(Duration.ofMinutes(1));
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 5);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).hasSize(2);
    // While suspended, further ratings never notify again.
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 1);
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).hasSize(2);

    jdbcTemplate.update(
        "UPDATE role_assignments SET suspension_reason = 'document_expired' WHERE user_id = ?"
            + " AND role = 'driver'",
        driver.userId());
    ResponseEntity<JsonNode> expired =
        post(
            "/api/v1/admin/users/" + driver.userId() + "/roles/driver/reactivate",
            Map.of("note", "try"),
            admin);
    assertThat(expired.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(expired)).isEqualTo("document_expired");
  }

  @Test
  @DisplayName(
      "RATE-03: the low_rating flag is listed with its rule, closed with a note once, and a"
          + " closed flag reopens only after a newer rating")
  void shouldQueueAndResolveLowRatingFlags() {
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 19, 3);
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 3);
    String support = supportAdmin("+963937650001");

    JsonNode queue = ok(get("/api/v1/admin/flags?kind=low_rating", support), HttpStatus.OK);
    assertThat(queue.get("totalElements").asInt()).isEqualTo(1);
    JsonNode flag = queue.get("items").get(0);
    assertThat(flag.get("user").get("userId").asText()).isEqualTo(driver.userId().toString());
    assertThat(flag.get("user").get("role").asText()).isEqualTo("driver");
    assertThat(flag.get("status").asText()).isEqualTo("open");
    assertThat(flag.get("details").get("average").decimalValue()).isEqualByComparingTo("3.00");
    assertThat(flag.get("details").get("warnAvgRating").decimalValue()).isEqualByComparingTo("3.5");
    String flagId = flag.get("id").asText();
    // Support may view (users:view) but not resolve (users:suspend).
    assertThat(
            post(
                    "/api/v1/admin/flags/" + flagId + "/resolve",
                    Map.of("resolution", "dismissed", "note", "ok"),
                    support)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(
                    "/api/v1/admin/flags/" + flagId + "/resolve",
                    Map.of("resolution", "dismissed", "note", " "),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    JsonNode closed =
        ok(
            post(
                "/api/v1/admin/flags/" + flagId + "/resolve",
                Map.of("resolution", "dismissed", "note", "Recent trips were fine"),
                admin),
            HttpStatus.OK);
    assertThat(closed.get("status").asText()).isEqualTo("dismissed");
    assertThat(closed.get("resolutionNote").asText()).isEqualTo("Recent trips were fine");
    ResponseEntity<JsonNode> twice =
        post(
            "/api/v1/admin/flags/" + flagId + "/resolve",
            Map.of("resolution", "actioned", "note", "again"),
            admin);
    assertThat(twice.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(twice)).isEqualTo("already_resolved");
    assertThat(auditActions(flagId)).containsExactly("flag.resolve");
    assertThat(ok(get("/api/v1/admin/flags", admin), HttpStatus.OK).get("totalElements").asInt())
        .isZero();

    // Ruling 2026-10-16: the nightly pass alone never reopens a closed flag, though the average
    // is still below 3.5 — only a rating stored after the closing does.
    advance(Duration.ofDays(1));
    dailyJob();
    assertThat(flags(driver.userId()))
        .extracting(row -> row.get("status"))
        .containsExactly("dismissed");
    advance(Duration.ofMinutes(1));
    rateOk(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 4);
    assertThat(flags(driver.userId())).hasSize(1); // never on the rating itself
    dailyJob();
    // 64 / 21 = 3.05: still below 3.5, with a newer rating -> the next pass opens a new flag.
    assertThat(flags(driver.userId()))
        .extracting(row -> row.get("status"))
        .containsExactly("dismissed", "open");
    assertThat(get("/api/v1/admin/flags?kind=nope", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "History pages carry the caller's own myRating and the counterpart's first name; admin"
          + " summaries do not")
  void shouldShowMyRatingAndCounterpartInHistory() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID rated = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    fixtureRating(rated, rider.userId(), "rider", driver.userId(), "driver", 4);
    UUID old =
        completedRide(rider.userId(), driver.userId(), CLOCK.instant().minus(Duration.ofDays(8)));
    UUID open = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    UUID noDriver =
        ride(
            rider.userId(),
            null,
            "cancelled_by_rider",
            null,
            null,
            null,
            CLOCK.instant().minusSeconds(30));

    Map<String, JsonNode> riderRows = rows(get("/api/v1/rides?size=20", rider.token()));
    assertThat(riderRows).hasSize(4);
    assertRow(riderRows.get(rated.toString()), "submitted", 4, "Driver");
    assertRow(riderRows.get(old.toString()), "expired", null, "Driver");
    assertRow(riderRows.get(open.toString()), "pending", null, "Driver");
    JsonNode cancelled = riderRows.get(noDriver.toString());
    assertThat(cancelled.get("myRating").get("state").asText()).isEqualTo("not_applicable");
    assertThat(cancelled.get("myRating").get("windowEndsAt").isNull()).isTrue();
    assertThat(cancelled.get("counterpartFirstName").isNull()).isTrue();
    assertThat(cancelled.get("cancellationReason").asText()).isEqualTo("changed_mind");
    assertThat(riderRows.get(rated.toString()).get("cancellationReason").isNull()).isTrue();

    // The driver's side: their own (absent) ratings, the rider's first name.
    Map<String, JsonNode> driverRows = rows(get("/api/v1/driver/rides?size=20", driver.token()));
    assertThat(driverRows).hasSize(3);
    assertRow(driverRows.get(rated.toString()), "pending", null, "Rana");
    assertRow(driverRows.get(old.toString()), "expired", null, "Rana");

    // Admin search rows keep their M7 shape.
    JsonNode admin = ok(get("/api/v1/admin/rides?size=50", this.admin), HttpStatus.OK);
    assertThat(admin.get("items")).isNotEmpty();
    for (JsonNode item : admin.get("items")) {
      assertThat(item.has("myRating")).isFalse();
      assertThat(item.has("counterpartFirstName")).isFalse();
    }
  }

  private Map<String, JsonNode> rows(ResponseEntity<JsonNode> page) {
    Map<String, JsonNode> rows = new java.util.HashMap<>();
    for (JsonNode item : ok(page, HttpStatus.OK).get("items")) {
      rows.put(item.get("id").asText(), item);
    }
    return rows;
  }

  private static void assertRow(JsonNode row, String state, Integer score, String counterpart) {
    assertThat(row.get("myRating").get("state").asText()).isEqualTo(state);
    assertThat(row.get("myRating").get("windowEndsAt").isNull()).isFalse();
    if (score == null) {
      assertThat(row.get("myRating").get("score").isNull()).isTrue();
    } else {
      assertThat(row.get("myRating").get("score").asInt()).isEqualTo(score);
    }
    assertThat(row.get("counterpartFirstName").asText()).isEqualTo(counterpart);
  }

  private JsonNode ownDriverAggregate(Account driver) {
    return ownAggregate(driver, "driver");
  }

  private JsonNode ownAggregate(Account account, String role) {
    for (JsonNode entry : ok(get("/api/v1/users/me/ratings", account.token()), HttpStatus.OK)) {
      if (role.equals(entry.get("role").asText())) {
        return entry;
      }
    }
    throw new AssertionError("no " + role + " aggregate");
  }

  private JsonNode liveDriverAverage(Account driver) {
    JsonNode trust =
        ok(get("/api/v1/admin/users/" + driver.userId() + "/trust", admin), HttpStatus.OK);
    return roleTrust(trust, "driver").get("liveAverage");
  }

  static JsonNode roleTrust(JsonNode trust, String role) {
    for (JsonNode entry : trust.get("roles")) {
      if (role.equals(entry.get("role").asText())) {
        return entry;
      }
    }
    throw new AssertionError("no " + role + " role");
  }

  private static JsonNode roleOf(JsonNode profile, String role) {
    for (JsonNode entry : profile.get("roles")) {
      if (role.equals(entry.get("role").asText())) {
        return entry;
      }
    }
    throw new AssertionError("no " + role + " role");
  }
}
