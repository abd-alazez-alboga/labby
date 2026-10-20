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
 * V1 audit H4 (UC-A-06 "edits apply to new rides only", regions-v1, V33): the service-type rates
 * and the region's wait / pickup-fee / cancellation values are locked on the ride at request; an
 * admin edit made while the ride is live never changes its fare, extras or cancellation fee. A ride
 * from before V33 (null snapshot) keeps reading the live config.
 */
class RidePricingSnapshotIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName("H4: a mid-ride rate and wait edit does not reach the ride's final fare")
  void shouldPriceCompletionFromTheSnapshot() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT pricing_snapshot ->> 'minimumFare' FROM rides WHERE ride_id = ?",
                String.class,
                rideId))
        .isEqualTo("1.50");
    dispatchAndAccept(rideId, driver);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);

    // The admin edits the config while the ride is live: far higher rates, no wait grace and a
    // high wait rate.
    editConfig();
    advance(Duration.ofMinutes(2)); // inside the LOCKED 5-min wait grace
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    JsonNode components = completed.get("fare").get("components");
    assertThat(components.get("baseFare").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(components.get("waitFare").decimalValue()).isEqualByComparingTo("0.00");
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo(FARE);
  }

  @Test
  @DisplayName("H4: a mid-ride cancellation fee / grace edit does not reach the ride")
  void shouldChargeTheLockedCancellationFee() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    editConfig(); // before acceptance: the grace and fee were locked at the request
    dispatchAndAccept(rideId, driver);
    JsonNode view = riderRide(rider, rideId);
    assertThat(view.get("cancellationGraceEndsAt").isNull()).isFalse();
    advance(Duration.ofMinutes(3)); // past the LOCKED 2-min grace (the edit says 30)
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/rides/" + rideId + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
  }

  @Test
  @DisplayName("H4: a ride from before V33 (no snapshot) still prices from the live config")
  void shouldFallBackToLiveConfigWithoutSnapshot() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    jdbcTemplate.update("UPDATE rides SET pricing_snapshot = NULL WHERE ride_id = ?", rideId);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    editConfig();
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(completed.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo("200.00");
  }

  /** Raises every rate and region value (as an admin edit would, straight in the tables). */
  private void editConfig() {
    jdbcTemplate.update(
        "UPDATE service_types SET base_fare = 100.00, per_km_rate = 30.00, per_min_rate = 10.00,"
            + " minimum_fare = 200.00 WHERE service_type_id = ?",
        economy);
    jdbcTemplate.update(
        "UPDATE regions SET wait_grace_min = 0, wait_per_min_rate = 50.00,"
            + " cancellation_grace_min = 30, cancellation_fee = 9.00, pickup_fee_threshold_km = 0,"
            + " pickup_fee_per_km = 20.00 WHERE region_id = ?",
        regionId);
  }
}
