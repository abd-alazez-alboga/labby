package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.ScheduledRideClockService;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M12 review fixes (docs/reviews/review-M12.md, owner rulings 2026-10-17) on the shared-ride
 * membership rules: a gathering membership counts as busy (H2) and dispatch drops a member found on
 * another live ride; a creator who left after dispatch is free (H3); one rider cannot race into two
 * memberships (W12); a rider-role suspension ends scheduled rides and pre-acceptance memberships
 * (W4); a shared ride ends at no_driver_found without retry (W5); history, view and share link
 * follow the member (W1, I1, I2).
 */
class SharedMembershipRulesIntegrationTest extends AbstractRideIntegrationTest {

  @Autowired private ScheduledRideClockService scheduledRideClockService;

  @Test
  @DisplayName("H2: a gathering member cannot book or schedule; a scheduled ride at T − 15 → busy")
  void shouldTreatGatheringMembershipAsBusy() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    // Scheduled first (allowed), then the gathering membership.
    Instant pickup = CLOCK.instant().plus(Duration.ofHours(2)).truncatedTo(ChronoUnit.MINUTES);
    UUID scheduled = schedule(creator, pickup);
    UUID shared = create(creator, 3, 1, "cash");
    Account member = rider();
    ok(join(member, shared, 1, "cash"), HttpStatus.OK);

    for (Account gathering : List.of(creator, member)) {
      assertThat(code(tryBook(gathering, booking(List.of())))).isEqualTo("active_ride_exists");
      assertThat(code(trySchedule(gathering, pickup.plus(Duration.ofHours(3)))))
          .isEqualTo("active_ride_exists");
    }

    CLOCK.set(pickup.minus(Duration.ofMinutes(15)));
    scheduledRideClockService.processDue();
    assertThat(stateOf(scheduled)).isEqualTo("cancelled_by_rider");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM rides WHERE ride_id = ?", String.class, scheduled))
        .isEqualTo("rider_busy");
  }

  @Test
  @DisplayName("H2: at dispatch a member already on another live ride is dropped free")
  void shouldDropBusyMemberAtDispatch() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID shared = create(creator, 3, 1, "cash");
    Account busy = rider();
    ok(join(busy, shared, 1, "cash"), HttpStatus.OK);
    // The busy member's own live ride (as reached through another instance / path).
    jdbcTemplate.update(
        "UPDATE shared_ride_members SET status = 'left', left_at = now() WHERE ride_id = ? AND"
            + " rider_user_id = ?",
        shared,
        busy.userId());
    UUID live = book(busy);
    jdbcTemplate.update(
        "UPDATE shared_ride_members SET status = 'joined', left_at = NULL WHERE ride_id = ? AND"
            + " rider_user_id = ?",
        shared,
        busy.userId());

    ok(post("/api/v1/shared-rides/" + shared + "/start", null, creator.token()), HttpStatus.OK);

    assertThat(stateOf(shared)).isEqualTo("requested");
    assertThat(memberStatus(shared, busy)).isEqualTo("left");
    assertThat(seatsTaken(shared)).isEqualTo(1);
    assertThat(outboxEvents(busy.userId())).contains("shared.cancelled");
    assertThat(stateOf(live)).isIn("requested", "offering");
  }

  @Test
  @DisplayName("H3: a creator who leaves after acceptance is free; the group rides on")
  void shouldFreeCreatorWhoLeftAfterDispatch() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID shared = create(creator, 2, 1, "cash");
    Account member = rider();
    ok(join(member, shared, 1, "cash"), HttpStatus.OK);
    dispatchAndAccept(shared, driver);
    ok(
        post(
            "/api/v1/shared-rides/" + shared + "/leave",
            Map.of("reason", "changed_mind"),
            creator.token()),
        HttpStatus.OK);
    assertThat(stateOf(shared)).isEqualTo("accepted");

    // The ride they left is no longer their active ride, and they may book again.
    assertThat(get("/api/v1/rides/active", creator.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    ok(tryBook(creator, booking(List.of())), HttpStatus.CREATED);
    // The member still rides along.
    assertThat(ok(get("/api/v1/rides/active", member.token()), HttpStatus.OK).get("id").asText())
        .isEqualTo(shared.toString());
  }

  @Test
  @DisplayName("W12: one rider racing into two shared rides gets exactly one membership")
  void shouldAllowOneOpenMembershipUnderRace() throws Exception {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID first = create(rider(), 3, 1, "cash");
    UUID second = create(rider(), 3, 1, "cash");
    Account racer = rider();
    List<HttpStatus> statuses =
        simultaneously(() -> join(racer, first, 1, "cash"), () -> join(racer, second, 1, "cash"));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM shared_ride_members WHERE rider_user_id = ? AND status ="
                    + " 'joined'",
                Integer.class,
                racer.userId()))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("W4: a rider-role suspension cancels scheduled rides and ends gathering memberships")
  void shouldEndScheduledAndGatheringOnRiderRoleSuspension() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();
    UUID scheduled =
        schedule(rider, CLOCK.instant().plus(Duration.ofHours(5)).truncatedTo(ChronoUnit.MINUTES));
    UUID shared = create(rider(), 3, 1, "cash");
    ok(join(rider, shared, 1, "cash"), HttpStatus.OK);

    assertThat(
            post(
                    "/api/v1/admin/users/" + rider.userId() + "/roles/rider/suspend",
                    Map.of("note", "Low rating"),
                    admin)
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();

    assertThat(stateOf(scheduled)).isEqualTo("cancelled_by_rider");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM rides WHERE ride_id = ?", String.class, scheduled))
        .isEqualTo("account_suspended");
    assertThat(memberStatus(shared, rider)).isEqualTo("left");
    assertThat(seatsTaken(shared)).isEqualTo(1);
  }

  @Test
  @DisplayName("W5: a shared ride with no driver ends — shared push text, retry refused")
  void shouldEndSharedRideWithoutRetry() {
    // A vehicle with the seats exists, but its driver is offline: nobody can take the ride.
    Account offline = driverAt(PICKUP_LAT, PICKUP_LNG);
    ok(put("/api/v1/driver/availability", Map.of("online", false), offline.token()), HttpStatus.OK);
    Account creator = rider();
    UUID shared = create(creator, 2, 1, "cash");
    Account member = rider();
    ok(join(member, shared, 1, "cash"), HttpStatus.OK); // full → requested, no driver around
    dispatch();
    assertThat(stateOf(shared)).isEqualTo("no_driver_found");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT params ->> 'shared' FROM notification_outbox WHERE user_id = ? AND event"
                    + " = 'ride.no_driver_found'",
                String.class,
                member.userId()))
        .isEqualTo("true");
    assertThat(code(post("/api/v1/rides/" + shared + "/retry", null, creator.token())))
        .isEqualTo("illegal_state");
  }

  @Test
  @DisplayName("W1 / I1 / I2: history, view and trip-share link follow the member")
  void shouldShowMembersOwnMoneyMethodAndLink() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID shared = create(creator, 3, 1, "cash");
    Account leaver = rider();
    Account member = rider();
    ok(join(leaver, shared, 1, "wallet"), HttpStatus.OK);
    ok(join(member, shared, 1, "cash"), HttpStatus.OK);
    dispatchAndAccept(shared, driver);

    // I1: the member's own method, never the creator's.
    assertThat(riderRide(leaver, shared).get("paymentMethod").asText()).isEqualTo("wallet");

    // I2: the leaver's link dies when they leave; another member's stays live.
    String leaverToken = shareToken(leaver, shared);
    String memberToken = shareToken(member, shared);
    CLOCK.set(CLOCK.instant().plus(Duration.ofMinutes(3))); // past the grace → a fee
    ok(
        post(
            "/api/v1/shared-rides/" + shared + "/leave",
            Map.of("reason", "changed_mind"),
            leaver.token()),
        HttpStatus.OK);
    assertThat(publicGet("/api/v1/share/" + leaverToken).getStatusCode())
        .isEqualTo(HttpStatus.GONE);
    assertThat(publicGet("/api/v1/share/" + memberToken).getStatusCode()).isEqualTo(HttpStatus.OK);

    arriveAndStart(shared, driver);
    ok(driverAction(driver, shared, "complete"), HttpStatus.OK);

    // W1: each history row carries the member's own money.
    JsonNode leaverRow = historyRow(leaver, shared);
    assertThat(leaverRow.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(leaverRow.get("total").isNull()).isTrue();
    JsonNode memberRow = historyRow(member, shared);
    assertThat(memberRow.get("total").decimalValue())
        .isEqualByComparingTo(
            jdbcTemplate.queryForObject(
                "SELECT share_amount FROM shared_ride_members WHERE ride_id = ? AND rider_user_id"
                    + " = ?",
                java.math.BigDecimal.class,
                shared,
                member.userId()));
  }

  // ---- helpers -------------------------------------------------------------------------------

  private UUID create(Account creator, int totalSeats, int partySize, String paymentMethod) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", paymentMethod);
    body.put("totalSeats", totalSeats);
    body.put("partySize", partySize);
    body.put("departure", Map.of("mode", "when_full"));
    JsonNode ride = ok(post("/api/v1/shared-rides", body, creator.token()), HttpStatus.CREATED);
    return UUID.fromString(ride.get("rideId").asText());
  }

  private ResponseEntity<JsonNode> join(
      Account rider, UUID rideId, int partySize, String paymentMethod) {
    return post(
        "/api/v1/shared-rides/" + rideId + "/join",
        Map.of("partySize", partySize, "paymentMethod", paymentMethod),
        rider.token());
  }

  private ResponseEntity<JsonNode> trySchedule(Account rider, Instant scheduledAt) {
    Map<String, Object> body = new LinkedHashMap<>(booking(List.of()));
    body.put("scheduledAt", scheduledAt.toString());
    return post("/api/v1/scheduled-rides", body, rider.token());
  }

  private UUID schedule(Account rider, Instant scheduledAt) {
    return UUID.fromString(
        ok(trySchedule(rider, scheduledAt), HttpStatus.CREATED).get("id").asText());
  }

  private String memberStatus(UUID rideId, Account rider) {
    return jdbcTemplate.queryForObject(
        "SELECT status FROM shared_ride_members WHERE ride_id = ? AND rider_user_id = ? ORDER BY"
            + " joined_at DESC LIMIT 1",
        String.class,
        rideId,
        rider.userId());
  }

  private int seatsTaken(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT seats_taken FROM shared_rides WHERE ride_id = ?", Integer.class, rideId);
  }

  private String shareToken(Account account, UUID rideId) {
    JsonNode link =
        ok(
            post("/api/v1/rides/" + rideId + "/share-links", null, account.token()),
            HttpStatus.CREATED);
    String url = link.get("url").asText();
    return url.substring(url.lastIndexOf('/') + 1);
  }

  private ResponseEntity<JsonNode> publicGet(String path) {
    return restTemplate.exchange(
        path, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), JsonNode.class);
  }

  private JsonNode historyRow(Account rider, UUID rideId) {
    for (JsonNode row : ok(get("/api/v1/rides", rider.token()), HttpStatus.OK).get("items")) {
      if (row.get("id").asText().equals(rideId.toString())) {
        return row;
      }
    }
    throw new AssertionError("ride " + rideId + " not in history");
  }
}
