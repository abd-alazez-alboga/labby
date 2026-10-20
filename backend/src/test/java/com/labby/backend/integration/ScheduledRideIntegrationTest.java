package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.ScheduledRideClockService;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M12-T2 Phase A (scheduled-shared-v1.yaml, RIDE-S1..4, DRV-05, UC-R-10/11, UC-D-05/11/12) on the
 * controlled clock: scheduling and its minimum lead, availability windows, the claim board and the
 * claim race, release, reminders (both tiers, skipped tiers, a re-run after a "restart"),
 * conversion at T − 15, fallback to live dispatch and its failure push, the offline-claimer and
 * rider-busy rulings, free cancellation, and the suspension side effects.
 */
class ScheduledRideIntegrationTest extends AbstractRideIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  @Autowired private ScheduledRideClockService scheduledRideClockService;

  @Test
  @DisplayName("RIDE-S1: scheduling needs 30 min lead, prices without surge, never blocks booking")
  void shouldScheduleWithMinimumLeadAndNoSurge() {
    Account rider = rider();
    ResponseEntity<JsonNode> tooSoon =
        post("/api/v1/scheduled-rides", scheduling(in(Duration.ofMinutes(29))), rider.token());
    assertThat(tooSoon.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(tooSoon)).isEqualTo("scheduled_too_soon");
    assertThat(tooSoon.getBody().path("details").path("minLeadMinutes").asInt()).isEqualTo(30);

    JsonNode ride =
        ok(
            post("/api/v1/scheduled-rides", scheduling(in(Duration.ofDays(3))), rider.token()),
            HttpStatus.CREATED);
    assertThat(ride.get("state").asText()).isEqualTo("scheduled");
    assertThat(ride.get("kind").asText()).isEqualTo("scheduled");
    assertThat(ride.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(ride.path("scheduled").path("claimState").asText()).isEqualTo("open");
    assertThat(ride.path("scheduled").path("pricedAtRideTime").asBoolean()).isTrue();
    // Not the rider's active ride: an on-demand booking still goes through (UC-R-04 E4).
    book(rider);
    JsonNode upcoming = ok(get("/api/v1/scheduled-rides", rider.token()), HttpStatus.OK);
    assertThat(upcoming).hasSize(1);

    Map<String, Object> estimate = new LinkedHashMap<>(booking(List.of()));
    estimate.put("scheduledAt", in(Duration.ofDays(1)).toString());
    JsonNode priced = ok(post("/api/v1/rides/estimate", estimate, rider.token()), HttpStatus.OK);
    assertThat(priced.get("pricedAtRideTime").asBoolean()).isTrue();
    assertThat(priced.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.00");
  }

  @Test
  @DisplayName("DRV-05: the weekly set is replaced at once; duplicates and bad times are 400")
  void shouldReplaceAvailabilityWindows() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String url = "/api/v1/driver/availability-windows";
    JsonNode stored =
        ok(
            put(
                url,
                Map.of(
                    "windows", List.of(window(5, "22:00", "02:00"), window(1, "08:00", "12:00"))),
                driver.token()),
            HttpStatus.OK);
    assertThat(stored.get("windows")).hasSize(2);
    assertThat(stored.get("windows").get(0).get("dayOfWeek").asInt()).isEqualTo(1);
    Map<String, Object> twice = window(2, "08:00", "09:00");
    assertThat(put(url, Map.of("windows", List.of(twice, twice)), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            put(url, Map.of("windows", List.of(window(2, "8:00", "09:00"))), driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    ok(put(url, Map.of("windows", List.of()), driver.token()), HttpStatus.OK);
    assertThat(ok(get(url, driver.token()), HttpStatus.OK).get("windows")).isEmpty();
  }

  @Test
  @DisplayName("RIDE-S2: the board shows only window-covered rides beyond the lead, area-rounded")
  void shouldFilterBoardByWindowsAndLead() {
    Account rider = rider();
    // Local noon (Damascus) two days ahead, so the window edges below are deterministic.
    Instant pickup =
        local(CLOCK.instant()).plusDays(2).truncatedTo(ChronoUnit.DAYS).withHour(12).toInstant();
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    assertThat(board(driver).get("items")).isEmpty();
    // Another weekday does not cover it.
    coverWholeDay(driver, local(pickup).plusDays(1));
    assertThat(board(driver).get("items")).isEmpty();
    // An overnight window from the day before belongs to that day and ends EXCLUSIVELY: until
    // 12:00 it misses the noon pickup, until 12:01 it covers it.
    int dayBefore = local(pickup).minusDays(1).getDayOfWeek().getValue();
    setWindows(driver, window(dayBefore, "22:00", "12:00"));
    assertThat(board(driver).get("items")).isEmpty();
    setWindows(driver, window(dayBefore, "22:00", "12:01"));
    assertThat(board(driver).get("items")).hasSize(1);
    coverWholeDay(driver, local(pickup));
    JsonNode items = board(driver).get("items");
    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(items.get(0).get("pickupArea").get("lat").asDouble()).isEqualTo(33.5);
    assertThat(items.get(0).get("pricedAtRideTime").asBoolean()).isTrue();
    assertThat(board(driver).get("totalItems").asLong()).isEqualTo(1);
    // The rider's own driver account never sees their ride; past the fallback lead it is gone.
    advance(Duration.between(CLOCK.instant(), pickup).minus(Duration.ofMinutes(15)));
    assertThat(board(driver).get("items")).isEmpty();
  }

  @Test
  @DisplayName("UC-D-11 E1: two drivers claim at once — one wins, the other gets already_claimed")
  void shouldLetExactlyOneDriverWinTheClaimRace() throws Exception {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(2));
    UUID rideId = schedule(rider, pickup);
    Account first = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account second = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(first, local(pickup));
    coverWholeDay(second, local(pickup));
    List<HttpStatus> statuses =
        simultaneously(() -> claim(first, rideId), () -> claim(second, rideId));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    Account loser = statuses.get(0) == HttpStatus.OK ? second : first;
    assertThat(code(claim(loser, rideId))).isEqualTo("already_claimed");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM scheduled_rides WHERE ride_id = ? AND claimed_driver_user_id"
                    + " IS NOT NULL",
                Integer.class,
                rideId))
        .isEqualTo(1);
    assertThat(outboxEvents(rider.userId())).contains("scheduled.claimed");
    JsonNode riderView = riderRide(rider, rideId);
    assertThat(riderView.path("scheduled").path("claimState").asText()).isEqualTo("claimed");
    assertThat(riderView.path("scheduled").path("claimedBy").path("firstName").asText())
        .isNotBlank();
    assertThat(board(loser).get("items")).isEmpty();
  }

  @Test
  @DisplayName("RIDE-S2: a claim re-checks the window and closes within the fallback lead")
  void shouldRecheckEligibilityAndCloseClaims() {
    Account rider = rider();
    Instant pickup = in(Duration.ofMinutes(40));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    ResponseEntity<JsonNode> noWindow = claim(driver, rideId);
    assertThat(noWindow.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(noWindow.getBody().path("details").path("rule").asText()).isEqualTo("window");
    coverWholeDay(driver, local(pickup));
    advance(Duration.ofMinutes(26));
    assertThat(code(claim(driver, rideId))).isEqualTo("claim_closed");
  }

  @Test
  @DisplayName("UC-D-12 E1: a release is reasoned, recorded, back on the board, rider told")
  void shouldReleaseClaimBackToTheBoard() {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    assertThat(ok(get("/api/v1/driver/scheduled-rides", driver.token()), HttpStatus.OK)).hasSize(1);
    String url = "/api/v1/driver/scheduled-rides/" + rideId + "/release";
    assertThat(post(url, Map.of("reason", "other"), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(post(url, Map.of("reason", "account_suspended"), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(post(url, Map.of("reason", "vehicle_issue"), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT reason FROM scheduled_claim_releases WHERE ride_id = ?",
                String.class,
                rideId))
        .isEqualTo("vehicle_issue");
    assertThat(outboxEvents(rider.userId())).contains("scheduled.released");
    // DRV-06: the release counts as one driver cancellation out of one (UC-D-12 E1).
    JsonNode week =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("windows").get(0);
    assertThat(week.get("cancellation").get("numerator").asLong()).isEqualTo(1);
    assertThat(week.get("cancellation").get("denominator").asLong()).isEqualTo(1);
    assertThat(board(driver).get("items")).hasSize(1);
    assertThat(post(url, Map.of("reason", "vehicle_issue"), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("RIDE-S3: both tiers reach both parties exactly once, even when the job re-runs")
  void shouldSendBothReminderTiersOnce() {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    scheduledRideClockService.processDue();
    assertThat(reminders(rider.userId(), rideId)).isEmpty();

    advanceTo(pickup.minus(Duration.ofHours(24)));
    scheduledRideClockService.processDue();
    scheduledRideClockService.processDue(); // a second tick (or another instance) adds nothing
    assertThat(reminders(rider.userId(), rideId)).containsExactly("1440");
    assertThat(reminders(driver.userId(), rideId)).containsExactly("1440");

    advanceTo(pickup.minus(Duration.ofHours(1)));
    scheduledRideClockService.processDue();
    assertThat(reminders(rider.userId(), rideId)).containsExactly("1440", "60");
    assertThat(reminders(driver.userId(), rideId)).containsExactly("1440", "60");
  }

  @Test
  @DisplayName("RIDE-S3: tiers before the booking are skipped; a job down across both sends one")
  void shouldSkipPastTiersAndCatchUpWithOneReminder() {
    Account rider = rider();
    // Booked 3 h ahead: the 24 h tier is already past — never sent.
    Instant soon = in(Duration.ofHours(3));
    UUID soonRide = schedule(rider, soon);
    advanceTo(soon.minus(Duration.ofMinutes(50)));
    scheduledRideClockService.processDue();
    assertThat(reminders(rider.userId(), soonRide)).containsExactly("60");

    // A job down from before T − 24 h until T − 30 min pushes only the latest tier.
    Account other = rider();
    Instant later = CLOCK.instant().plus(Duration.ofDays(2));
    UUID laterRide = schedule(other, later);
    advanceTo(later.minus(Duration.ofMinutes(30)));
    scheduledRideClockService.processDue();
    assertThat(reminders(other.userId(), laterRide)).containsExactly("60");
  }

  @Test
  @DisplayName("RIDE-S3: at T − 15 a claimed ride becomes accepted with its driver, both told")
  void shouldConvertClaimedRideAtTheLead() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(16)));
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("scheduled");
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    JsonNode active = ok(get("/api/v1/driver/rides/active", driver.token()), HttpStatus.OK);
    assertThat(active.get("id").asText()).isEqualTo(rideId.toString());
    assertThat(active.path("scheduled").path("claimState").asText()).isEqualTo("converted");
    assertThat(active.get("cancellationGraceEndsAt").isNull()).isFalse();
    assertThat(outboxEvents(rider.userId())).contains("scheduled.converted");
    assertThat(outboxEvents(driver.userId())).contains("scheduled.converted");
    // The live flow applies from here (UC-D-12): arrive + start work as for any ride.
    arriveAndStart(rideId, driver);
    assertThat(stateOf(rideId)).isEqualTo("in_progress");
    // Review W2: no live offer — on time = arrived by the pickup time + 5 min (DRV-06).
    JsonNode onTime =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK)
            .get("windows")
            .get(0)
            .get("onTime");
    assertThat(onTime.get("numerator").asInt()).isEqualTo(1);
    assertThat(onTime.get("denominator").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("Ruling 2026-10-17: a converted ride redispatches as a plain live ride")
  void shouldRedispatchConvertedScheduledRideAsOnDemand() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "vehicle_issue"),
            driver.token()),
        HttpStatus.OK);
    JsonNode cancelled = riderRide(rider, rideId);
    UUID newRideId = UUID.fromString(cancelled.get("redispatchedAsRideId").asText());
    JsonNode redispatched = riderRide(rider, newRideId);
    assertThat(redispatched.get("kind").asText()).isEqualTo("on_demand");
    assertThat(redispatched.get("state").asText()).isEqualTo("requested");
    assertThat(
            redispatched.path("scheduled").isMissingNode()
                || redispatched.path("scheduled").isNull())
        .isTrue();
  }

  @Test
  @DisplayName("M12 I3: history sorts a converted ride at its conversion time, not booking time")
  void shouldSortConvertedRideByConversionTimeInHistory() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID scheduledId = schedule(rider, pickup); // booked now: the oldest requested_at

    // The rider's own later live ride (cancelled, so the conversion is not blocked).
    UUID riderLive = book(rider);
    ok(
        post(
            "/api/v1/rides/" + riderLive + "/cancel",
            Map.of("reason", "changed_mind"),
            rider.token()),
        HttpStatus.OK);

    // The driver's later live ride, completed and settled so the claim can convert.
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID driverLive = book(rider());
    dispatchAndAccept(driverLive, driver);
    arriveAndStart(driverLive, driver);
    ok(driverAction(driver, driverLive, "complete"), HttpStatus.OK);
    ok(driverAction(driver, driverLive, "cash-confirm"), HttpStatus.OK);

    coverWholeDay(driver, local(pickup));
    ok(claim(driver, scheduledId), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(scheduledId)).isEqualTo("accepted");

    // Both histories: the converted ride ran last, so it comes first despite its booking time.
    JsonNode riderHistory = ok(get("/api/v1/rides", rider.token()), HttpStatus.OK);
    assertThat(riderHistory.get("items").get(0).get("id").asText())
        .isEqualTo(scheduledId.toString());
    assertThat(riderHistory.get("items").get(1).get("id").asText()).isEqualTo(riderLive.toString());
    JsonNode driverHistory = ok(get("/api/v1/driver/rides", driver.token()), HttpStatus.OK);
    assertThat(driverHistory.get("items").get(0).get("id").asText())
        .isEqualTo(scheduledId.toString());
    assertThat(driverHistory.get("items").get(1).get("id").asText())
        .isEqualTo(driverLive.toString());
  }

  @Test
  @DisplayName("RIDE-S4: unclaimed at T − 15 falls into live dispatch; failing that, replan push")
  void shouldFallBackToLiveDispatchAndReportFailure() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("requested");
    Instant requestedAt =
        jdbcTemplate.queryForObject(
            "SELECT requested_at FROM rides WHERE ride_id = ?", Instant.class, rideId);
    assertThat(requestedAt).isAfter(pickup.minus(Duration.ofMinutes(16)));
    dispatch();
    assertThat(openOffer(driver).get("rideId").asText()).isEqualTo(rideId.toString());
    // Nobody accepts: the rides-v1 give-up (10 min from the fallback moment) ends it.
    for (int tick = 0; tick < 45 && !"no_driver_found".equals(stateOf(rideId)); tick++) {
      advance(Duration.ofSeconds(16));
      dispatch();
    }
    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT params ->> 'scheduled' FROM notification_outbox WHERE user_id = ? AND"
                    + " event = 'ride.no_driver_found'",
                String.class,
                rider.userId()))
        .isEqualTo("true");
  }

  @Test
  @DisplayName(
      "Ruling 2026-10-16: an offline claimer loses the claim at T − 15, the ride falls back")
  void shouldReleaseOfflineClaimerAndFallBack() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    ok(put("/api/v1/driver/availability", Map.of("online", false), driver.token()), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(
            jdbcTemplate.queryForMap(
                "SELECT reason, note FROM scheduled_claim_releases WHERE ride_id = ?", rideId))
        .containsEntry("reason", "other")
        .containsEntry("note", "unavailable_at_conversion");
  }

  @Test
  @DisplayName("Review H1: the claim wins — the claimer's open live offer is withdrawn at T − 15")
  void shouldWithdrawClaimersLiveOfferAtConversion() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    // Just before T − 15 another rider's live request reaches the (free, online) claimer.
    advanceTo(pickup.minus(Duration.ofMinutes(15)).minusSeconds(5));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID live = book(rider());
    dispatch();
    String offerId = openOffer(driver).get("id").asText();

    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    scheduledRideClockService.processDue();

    assertThat(stateOf(rideId)).isEqualTo("accepted");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT response FROM ride_offers WHERE ride_offer_id = ?::uuid",
                String.class,
                offerId))
        .isEqualTo("withdrawn");
    // The withdrawn offer can no longer be taken; the live ride waits for its next candidate.
    assertThat(code(accept(driver, offerId))).isEqualTo("offer_closed");
    assertThat(stateOf(live)).isEqualTo("offering");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rides WHERE driver_user_id = ? AND state = 'accepted'",
                Integer.class,
                driver.userId()))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("Review H1: a driver already on a live ride cannot accept another offer")
  void shouldRefuseAcceptWhileOnAnotherRide() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID first = book(rider());
    dispatchAndAccept(first, driver);
    UUID second = book(rider());
    // A stray open offer for the busy driver (another path / instance): accept must refuse it.
    jdbcTemplate.update(
        "UPDATE rides SET state = 'offering', offering_at = now() WHERE ride_id = ?", second);
    UUID offerId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO ride_offers (ride_offer_id, ride_id, driver_user_id, vehicle_id, sequence,"
            + " pickup_distance_m, pickup_eta_s, offered_at, expires_at)"
            + " SELECT ?, ?, driver_user_id, vehicle_id, 1, 100, 60, ?, ? FROM rides"
            + " WHERE ride_id = ?",
        offerId,
        second,
        java.sql.Timestamp.from(CLOCK.instant()),
        java.sql.Timestamp.from(CLOCK.instant().plusSeconds(15)),
        first);
    assertThat(code(accept(driver, offerId.toString()))).isEqualTo("driver_busy");
    assertThat(stateOf(second)).isEqualTo("offering");
  }

  @Test
  @DisplayName(
      "Review W3: conversion binds the driver's new active vehicle when it serves the ride")
  void shouldConvertWithTheNewActiveVehicle() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    UUID replacement = switchVehicle(driver, true);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT vehicle_id FROM rides WHERE ride_id = ?", UUID.class, rideId))
        .isEqualTo(replacement);
  }

  @Test
  @DisplayName(
      "Review W3: a new vehicle that can't serve the ride → claim back to the board, no metric")
  void shouldReleaseWithoutMetricWhenTheNewVehicleCannotServe() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    switchVehicle(driver, false);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT reason FROM scheduled_claim_releases WHERE ride_id = ?",
                String.class,
                rideId))
        .isEqualTo("vehicle_changed");
    assertThat(outboxEvents(driver.userId())).contains("scheduled.claim_lost");
    // Not a cancellation-metric event (DRV-06).
    JsonNode performance = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(performance.get("windows").get(0).get("cancellation").get("numerator").asInt())
        .isZero();
  }

  @Test
  @DisplayName(
      "Ruling 2026-10-16: a rider on another live ride at T − 15 → cancelled free, both told")
  void shouldCancelWhenRiderIsBusy() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(20)));
    book(rider);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("cancelled_by_rider");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM rides WHERE ride_id = ? AND cancellation_fee IS"
                    + " NULL",
                String.class,
                rideId))
        .isEqualTo("rider_busy");
    assertThat(outboxEvents(rider.userId())).contains("scheduled.cancelled_rider_busy");
    assertThat(outboxEvents(driver.userId())).contains("scheduled.cancelled_rider_busy");
  }

  @Test
  @DisplayName("UC-R-11 / ruling: a scheduled ride cancels free; the claiming driver is told")
  void shouldCancelScheduledRideFree() {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(1));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    JsonNode quote =
        ok(get("/api/v1/rides/" + rideId + "/cancellation-quote", rider.token()), HttpStatus.OK);
    assertThat(quote.get("free").asBoolean()).isTrue();
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/rides/" + rideId + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("state").asText()).isEqualTo("cancelled_by_rider");
    assertThat(cancelled.get("cancellationFee").isNull()).isTrue();
    assertThat(outboxEvents(driver.userId())).contains("ride.cancelled_by_rider");
    assertThat(code(claim(driver, rideId))).isEqualTo("claim_closed");
  }

  @Test
  @DisplayName("Suspension: a suspended driver's claims are released without a metric event")
  void shouldReleaseClaimsOfSuspendedDriver() {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(1));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    assertThat(
            post(
                    "/api/v1/admin/users/" + driver.userId() + "/roles/driver/suspend",
                    Map.of("note", "Investigation"),
                    admin)
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT reason FROM scheduled_claim_releases WHERE ride_id = ?",
                String.class,
                rideId))
        .isEqualTo("account_suspended");
    assertThat(riderRide(rider, rideId).path("scheduled").path("claimState").asText())
        .isEqualTo("open");
    // A suspension release is not the driver's cancellation (no metric event).
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM scheduled_claim_releases WHERE driver_user_id = ? AND reason"
                    + " <> 'account_suspended'",
                Integer.class,
                driver.userId()))
        .isZero();
  }

  @Test
  @DisplayName(
      "UC-A-07 E1 (review V1 W38): disabling a type with a claimed scheduled ride is a 409 listing"
          + " it until acknowledged; the ride keeps its claim")
  void shouldWarnBeforeDisablingATypeWithClaimedRides() {
    Account rider = rider();
    Instant pickup = in(Duration.ofDays(2));
    UUID claimed = schedule(rider, pickup);
    schedule(rider(), in(Duration.ofDays(3))); // unclaimed: not listed
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, claimed), HttpStatus.OK);
    Map<String, Object> disabled = new LinkedHashMap<>();
    disabled.put("nameEn", "Economy");
    disabled.put("nameAr", "اقتصادي");
    disabled.put("baseFare", 1.00);
    disabled.put("perKmRate", 0.50);
    disabled.put("perMinRate", 0.10);
    disabled.put("minimumFare", 1.50);
    disabled.put("enabled", false);
    String url = "/api/v1/admin/service-types/" + economy;

    ResponseEntity<JsonNode> warned = put(url, disabled, admin);
    assertThat(warned.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(warned)).isEqualTo("service_type_has_claimed_rides");
    JsonNode rides = warned.getBody().get("details").get("rides");
    assertThat(rides).hasSize(1);
    assertThat(rides.get(0).get("rideId").asText()).isEqualTo(claimed.toString());
    assertThat(rides.get(0).get("claimedDriverUserId").asText())
        .isEqualTo(driver.userId().toString());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT enabled FROM service_types WHERE service_type_id = ?",
                Boolean.class,
                economy))
        .isTrue();

    JsonNode acknowledged =
        ok(put(url + "?acknowledgeClaimedRides=true", disabled, admin), HttpStatus.OK);
    assertThat(acknowledged.get("enabled").asBoolean()).isFalse();
    // Existing rides are unaffected (UC-A-07): the claim stands.
    assertThat(ok(get("/api/v1/driver/scheduled-rides", driver.token()), HttpStatus.OK)).hasSize(1);
    // Editing an already disabled type needs no acknowledgement.
    ok(put(url, disabled, admin), HttpStatus.OK);
  }

  // ---- helpers -------------------------------------------------------------------------------

  private Instant in(Duration duration) {
    return CLOCK.instant().plus(duration).truncatedTo(ChronoUnit.MINUTES);
  }

  private void advanceTo(Instant moment) {
    CLOCK.set(moment);
  }

  private static ZonedDateTime local(Instant instant) {
    return instant.atZone(DAMASCUS);
  }

  private Map<String, Object> scheduling(Instant scheduledAt) {
    Map<String, Object> body = new LinkedHashMap<>(booking(List.of()));
    body.put("scheduledAt", scheduledAt.toString());
    return body;
  }

  private UUID schedule(Account rider, Instant scheduledAt) {
    JsonNode ride =
        ok(
            post("/api/v1/scheduled-rides", scheduling(scheduledAt), rider.token()),
            HttpStatus.CREATED);
    return UUID.fromString(ride.get("id").asText());
  }

  private static Map<String, Object> window(int day, String startsAt, String endsAt) {
    return Map.of("dayOfWeek", day, "startsAt", startsAt, "endsAt", endsAt);
  }

  /** A whole-day window (start = end) on the local weekday of {@code day}. */
  private void coverWholeDay(Account driver, ZonedDateTime day) {
    setWindows(driver, window(day.getDayOfWeek().getValue(), "00:00", "00:00"));
  }

  private void setWindows(Account driver, Map<String, Object> window) {
    ok(
        put(
            "/api/v1/driver/availability-windows",
            Map.of("windows", List.of(window)),
            driver.token()),
        HttpStatus.OK);
  }

  private JsonNode board(Account driver) {
    return ok(get("/api/v1/driver/claim-board", driver.token()), HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> claim(Account driver, UUID rideId) {
    return post("/api/v1/driver/scheduled-rides/" + rideId + "/claim", null, driver.token());
  }

  /** The {@code minutesBefore} of every reminder queued for the user about the ride, in order. */
  private List<String> reminders(UUID userId, UUID rideId) {
    return jdbcTemplate.queryForList(
        "SELECT params ->> 'minutesBefore' FROM notification_outbox WHERE user_id = ? AND event ="
            + " 'scheduled.reminder' AND params ->> 'rideId' = ? ORDER BY created_at, (params ->>"
            + " 'minutesBefore')::int DESC",
        String.class,
        userId,
        rideId.toString());
  }

  /**
   * Gives the driver a second approved vehicle (a copy of the active one, new plate) and makes it
   * the active one; {@code serves} copies the service types too.
   */
  private UUID switchVehicle(Account driver, boolean serves) {
    UUID current =
        jdbcTemplate.queryForObject(
            "SELECT vehicle_id FROM vehicles WHERE driver_user_id = ? AND is_active",
            UUID.class,
            driver.userId());
    String columns =
        jdbcTemplate.queryForObject(
            "SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE"
                + " table_name = 'vehicles' AND column_name NOT IN ('vehicle_id', 'plate',"
                + " 'is_active')",
            String.class);
    UUID replacement = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, plate, is_active, "
            + columns
            + ") SELECT ?, ?, false, "
            + columns
            + " FROM vehicles WHERE vehicle_id = ?",
        replacement,
        "SW-" + replacement.toString().substring(0, 6),
        current);
    if (serves) {
      jdbcTemplate.update(
          "INSERT INTO vehicle_service_types (vehicle_id, service_type_id) SELECT ?,"
              + " service_type_id FROM vehicle_service_types WHERE vehicle_id = ?",
          replacement,
          current);
    }
    jdbcTemplate.update("UPDATE vehicles SET is_active = false WHERE vehicle_id = ?", current);
    jdbcTemplate.update("UPDATE vehicles SET is_active = true WHERE vehicle_id = ?", replacement);
    return replacement;
  }
}
