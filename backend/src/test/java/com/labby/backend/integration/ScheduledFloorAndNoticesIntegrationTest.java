package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.NotificationDispatchService;
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
 * V1 audit H7 (owner ruling 2026-10-20: the COM-03 floor blocks the scheduled claim board, claims
 * and conversion) and W42 / W22 (the claimer is told when the system releases the claim at
 * conversion, with the pickup time, the rider's first name and whether it counts as a release).
 */
class ScheduledFloorAndNoticesIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  @Autowired private ScheduledRideClockService scheduledRideClockService;
  @Autowired private NotificationDispatchService notificationDispatchService;

  @Test
  @DisplayName("H7: a floor-blocked driver sees an empty board with the reason and cannot claim")
  void shouldBlockBoardAndClaimAtTheFloor() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    assertThat(board(driver).get("items")).hasSize(1);
    assertThat(board(driver).get("blockedReason").isNull()).isTrue();

    settle(driver.userId(), "50.00", "pay_out"); // the default −50 floor
    JsonNode blocked = board(driver);
    assertThat(blocked.get("items")).isEmpty();
    assertThat(blocked.get("blockedReason").asText()).isEqualTo("balance_below_floor");
    ResponseEntity<JsonNode> refused = claim(driver, rideId);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(refused)).isEqualTo("not_eligible");
    assertThat(refused.getBody().path("details").path("rule").asText())
        .isEqualTo("balance_below_floor");

    settle(driver.userId(), "45.00", "pay_in"); // lifted
    assertThat(board(driver).get("items")).hasSize(1);
    ok(claim(driver, rideId), HttpStatus.OK);
  }

  @Test
  @DisplayName("H7 + W42: a claimer below the floor at T − 15 is released (no metric) and told")
  void shouldReleaseFloorBlockedClaimerAtConversion() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    settle(driver.userId(), "50.00", "pay_out");
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();

    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(releaseReason(rideId)).isEqualTo("balance_below_floor");
    Map<String, Object> notice = driverNotice(driver.userId(), "scheduled.released");
    assertThat(notice)
        .containsEntry("reason", "balance_below_floor")
        .containsEntry("countsAsRelease", "false")
        .containsEntry("riderFirstName", "Rana")
        .containsEntry("pickupTime", local(pickup).toLocalTime().toString());
    // The push deep link carries the fields too (realtime-v1 push payload `params`).
    assertThat(linkParam(driver.userId(), "scheduled.released", "countsAsRelease"))
        .isEqualTo("false");
    JsonNode performance = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(performance.get("windows").get(0).get("cancellation").get("numerator").asInt())
        .isZero();
  }

  @Test
  @DisplayName("W42: an offline claimer released at T − 15 is told it counts as a release")
  void shouldTellOfflineClaimerItCountsAsRelease() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(2));
    UUID rideId = schedule(rider, pickup);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    coverWholeDay(driver, local(pickup));
    ok(claim(driver, rideId), HttpStatus.OK);
    ok(put("/api/v1/driver/availability", Map.of("online", false), driver.token()), HttpStatus.OK);
    advanceTo(pickup.minus(Duration.ofMinutes(15)));
    scheduledRideClockService.processDue();

    assertThat(releaseReason(rideId)).isEqualTo("other");
    assertThat(driverNotice(driver.userId(), "scheduled.released"))
        .containsEntry("reason", "unavailable")
        .containsEntry("countsAsRelease", "true")
        .containsEntry("pickupDate", local(pickup).toLocalDate().toString());
  }

  @Test
  @DisplayName("W22: the driver's rider-busy notice names the pickup time and the rider")
  void shouldNameTimeAndRiderInRiderBusyNotice() {
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
    assertThat(driverNotice(driver.userId(), "scheduled.cancelled_rider_busy"))
        .containsEntry("riderFirstName", "Rana")
        .containsEntry("pickupTime", local(pickup).toLocalTime().toString());
  }

  // ---- helpers -------------------------------------------------------------------------------

  private void settle(UUID driverUserId, String amount, String direction) {
    ok(
        post(
            "/api/v1/admin/drivers/" + driverUserId + "/settlements",
            Map.of("amount", amount, "direction", direction, "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
  }

  private String releaseReason(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT reason FROM scheduled_claim_releases WHERE ride_id = ?", String.class, rideId);
  }

  /** The params of the driver's (single) queued notice of {@code event}, as strings. */
  private Map<String, Object> driverNotice(UUID driverUserId, String event) {
    String json =
        jdbcTemplate.queryForObject(
            "SELECT params::text FROM notification_outbox WHERE user_id = ? AND event = ?",
            String.class,
            driverUserId,
            event);
    try {
      @SuppressWarnings("unchecked")
      Map<String, Object> params =
          new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
      return params;
    } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
      throw new IllegalStateException(ex);
    }
  }

  /** One deep-link param of the driver's notification-center row (delivered by the dispatcher). */
  private String linkParam(UUID driverUserId, String event, String key) {
    notificationDispatchService.dispatchPending();
    return jdbcTemplate.queryForObject(
        "SELECT link_params ->> ? FROM notifications WHERE user_id = ? AND event = ?",
        String.class,
        key,
        driverUserId,
        event);
  }

  private Instant in(Duration duration) {
    return CLOCK.instant().plus(duration).truncatedTo(ChronoUnit.MINUTES);
  }

  private void advanceTo(Instant moment) {
    CLOCK.set(moment);
  }

  private static ZonedDateTime local(Instant instant) {
    return instant.atZone(DAMASCUS);
  }

  private UUID schedule(Account rider, Instant scheduledAt) {
    Map<String, Object> body = new LinkedHashMap<>(booking(List.of()));
    body.put("scheduledAt", scheduledAt.toString());
    JsonNode ride = ok(post("/api/v1/scheduled-rides", body, rider.token()), HttpStatus.CREATED);
    return UUID.fromString(ride.get("id").asText());
  }

  /** A whole-day window (start = end) on the local weekday of {@code day}. */
  private void coverWholeDay(Account driver, ZonedDateTime day) {
    ok(
        put(
            "/api/v1/driver/availability-windows",
            Map.of(
                "windows",
                List.of(
                    Map.of(
                        "dayOfWeek",
                        day.getDayOfWeek().getValue(),
                        "startsAt",
                        "00:00",
                        "endsAt",
                        "00:00"))),
            driver.token()),
        HttpStatus.OK);
  }

  private JsonNode board(Account driver) {
    return ok(get("/api/v1/driver/claim-board", driver.token()), HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> claim(Account driver, UUID rideId) {
    return post("/api/v1/driver/scheduled-rides/" + rideId + "/claim", null, driver.token());
  }
}
