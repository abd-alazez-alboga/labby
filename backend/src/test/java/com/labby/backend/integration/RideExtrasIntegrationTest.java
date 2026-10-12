package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * PRC-03 extras in the fare engine (region config, SRS defaults when unset): the wait charge bills
 * minutes beyond the wait grace between Arrived and start (the rider notified ONCE when accrual
 * starts, via the monitor), and the pickup-distance fee bills the accepted offer's distance beyond
 * the threshold for {@code accept_distant_fee} riders.
 */
class RideExtrasIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName(
      "PRC-03: minutes beyond the wait grace land in waitFare — and the rider is notified"
          + " once when accrual starts")
  void shouldChargeWaitTime() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);

    // Inside the 5-minute grace: the monitor queues nothing.
    advance(Duration.ofMinutes(4));
    rideTrackingService.monitor();
    assertThat(outboxEvents(rider.userId())).doesNotContain("ride.wait_charge_started");

    // Past the grace: notified exactly once, however often the monitor ticks.
    advance(Duration.ofMinutes(2));
    rideTrackingService.monitor();
    rideTrackingService.monitor();
    assertThat(
            outboxEvents(rider.userId()).stream()
                .filter("ride.wait_charge_started"::equals)
                .count())
        .isEqualTo(1);

    // Start at Arrived + 9 min → 4 charged minutes × 0.25 = 1.00. The extras join BEFORE the
    // minimum-fare floor (RIDE-06): base 1.00 + wait 1.00 = 2.00, no top-up.
    advance(Duration.ofMinutes(3));
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    JsonNode components = completed.get("fare").get("components");
    assertThat(components.get("waitFare").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(components.get("minimumFareAdjustment").decimalValue()).isEqualByComparingTo("0");
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT wait_fare FROM fares WHERE ride_id = ?",
                java.math.BigDecimal.class,
                rideId))
        .isEqualByComparingTo("1.00");
  }

  @Test
  @DisplayName(
      "PRC-03: accept_distant_fee riders pay per km beyond the threshold; nearby_only"
          + " riders never see the fee")
  void shouldChargePickupDistanceFee() {
    Account rider = rider();
    // The rider opts into distant drivers (UC-R-03); disclosed pre-booking via the estimate rule.
    ok(
        put(
            "/api/v1/rider/preferences",
            Map.of(
                "temperature", "no_preference",
                "conversation", "no_preference",
                "music", "no_preference",
                "pickupDistanceMode", "accept_distant_fee"),
            rider.token()),
        HttpStatus.OK);
    JsonNode estimate =
        ok(
            post(
                "/api/v1/rides/estimate",
                Map.of(
                    "pickup", place(PICKUP_LAT, PICKUP_LNG),
                    "destination", place(DEST_LAT, DEST_LNG)),
                rider.token()),
            HttpStatus.OK);
    assertThat(estimate.get("pickupFeeRule").get("thresholdKm").decimalValue())
        .isEqualByComparingTo("10");
    assertThat(estimate.get("pickupFeeRule").get("perKm").decimalValue())
        .isEqualByComparingTo("0.50");

    // A driver ~13 km from the pickup (inside the region, beyond the 10 km threshold).
    Account driver = driverAt(33.59, 36.39);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    int offeredDistanceM =
        jdbcTemplate.queryForObject(
            "SELECT pickup_distance_m FROM ride_offers WHERE ride_id = ? AND response ="
                + " 'accepted'",
            Integer.class,
            rideId);
    assertThat(offeredDistanceM).isGreaterThan(10_000);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    java.math.BigDecimal expected =
        java.math.BigDecimal.valueOf(offeredDistanceM)
            .divide(java.math.BigDecimal.valueOf(1000), 6, java.math.RoundingMode.HALF_UP)
            .subtract(java.math.BigDecimal.TEN)
            .multiply(new java.math.BigDecimal("0.50"))
            .setScale(2, java.math.RoundingMode.HALF_UP);
    assertThat(completed.get("fare").get("components").get("pickupFee").decimalValue())
        .isEqualByComparingTo(expected);

    // A nearby_only rider is never charged: dispatch keeps distant drivers away entirely.
    Account nearbyRider = rider();
    position(driver, 33.59, 36.39);
    UUID starved = book(nearbyRider);
    dispatch();
    assertThat(stateOf(starved)).isEqualTo("no_driver_found");
  }

  @Test
  @DisplayName(
      "PRC-03 + RIDE-07: a region with NON-default values (grace 3 min, 0.40/min, 4 km,"
          + " 1.10/km, fee 3.50) charges exactly those values, never the SRS defaults")
  void shouldUseRegionValuesNotDefaults() {
    jdbcTemplate.update(
        "UPDATE regions SET wait_grace_min = 3, wait_per_min_rate = 0.40,"
            + " pickup_fee_threshold_km = 4.0, pickup_fee_per_km = 1.10, cancellation_fee = 3.50"
            + " WHERE region_id = ?",
        regionId);
    Account rider = rider();
    ok(
        put(
            "/api/v1/rider/preferences",
            Map.of(
                "temperature", "no_preference",
                "conversation", "no_preference",
                "music", "no_preference",
                "pickupDistanceMode", "accept_distant_fee"),
            rider.token()),
        HttpStatus.OK);
    JsonNode estimate =
        ok(
            post(
                "/api/v1/rides/estimate",
                Map.of(
                    "pickup", place(PICKUP_LAT, PICKUP_LNG),
                    "destination", place(DEST_LAT, DEST_LNG)),
                rider.token()),
            HttpStatus.OK);
    assertThat(estimate.get("pickupFeeRule").get("thresholdKm").decimalValue())
        .isEqualByComparingTo("4");
    assertThat(estimate.get("pickupFeeRule").get("perKm").decimalValue())
        .isEqualByComparingTo("1.10");

    // A driver ~6 km from the pickup: beyond the region's 4 km (but within the default 10 km).
    Account driver = driverAt(33.55, 36.33);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    int offeredDistanceM =
        jdbcTemplate.queryForObject(
            "SELECT pickup_distance_m FROM ride_offers WHERE ride_id = ? AND response ="
                + " 'accepted'",
            Integer.class,
            rideId);
    assertThat(offeredDistanceM).isBetween(4_001, 9_999);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);

    // The region's 3-minute grace (not the default 5): notified once past it, at the region rate.
    advance(Duration.ofMinutes(2));
    rideTrackingService.monitor();
    assertThat(outboxEvents(rider.userId())).doesNotContain("ride.wait_charge_started");
    advance(Duration.ofMinutes(1).plusSeconds(1));
    rideTrackingService.monitor();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT params->>'rate' FROM notification_outbox WHERE user_id = ? AND event ="
                    + " 'ride.wait_charge_started'",
                String.class,
                rider.userId()))
        .isEqualTo("0.40");

    // Start at Arrived + 5 min 30 s → 150 s past the grace × 0.40/min = 1.00.
    advance(Duration.ofMinutes(2).plusSeconds(29));
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    JsonNode components =
        ok(driverAction(driver, rideId, "complete"), HttpStatus.OK).get("fare").get("components");
    assertThat(components.get("waitFare").decimalValue()).isEqualByComparingTo("1.00");
    java.math.BigDecimal expectedPickupFee =
        java.math.BigDecimal.valueOf(offeredDistanceM)
            .divide(java.math.BigDecimal.valueOf(1000), 6, java.math.RoundingMode.HALF_UP)
            .subtract(new java.math.BigDecimal("4"))
            .multiply(new java.math.BigDecimal("1.10"))
            .setScale(2, java.math.RoundingMode.HALF_UP);
    assertThat(components.get("pickupFee").decimalValue()).isEqualByComparingTo(expectedPickupFee);

    // RIDE-07: the region's 3.50 fee (not the fixture's 2.00) is recorded and carried.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    JsonNode next = ok(tryBook(rider, booking("cash")), HttpStatus.CREATED);
    UUID cancelledId = UUID.fromString(next.get("id").asText());
    dispatchAndAccept(cancelledId, driver);
    advance(Duration.ofMinutes(3)); // region cancellation grace is 2 min
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/rides/" + cancelledId + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("cancellationFee").decimalValue()).isEqualByComparingTo("3.50");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM rider_dues WHERE source_ride_id = ?",
                java.math.BigDecimal.class,
                cancelledId))
        .isEqualByComparingTo("3.50");
  }
}
