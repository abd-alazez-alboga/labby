package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.config.RideSimProperties;
import com.labby.backend.runner.DevRideSimulator;
import com.labby.backend.service.DriverAvailabilityService;
import com.labby.backend.service.DriverLocationService;
import com.labby.backend.service.DriverRideService;
import com.labby.backend.service.RoutingProvider;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

/**
 * M7-T5 acceptance — the dev driver-simulation harness (DevRideSimulator) runs the scripted e2e
 * ride with nobody at the wheel: book → dispatch → sim accepts → drives to the pickup (geofenced
 * arrive on its STREAMED position) → start → drives the trip → complete → cash — twice in a row
 * with the same sim driver (repeatably), each ride receipted, and the admin detail carrying the
 * full truth (timeline, offers trail, both trace phases, stored fare components). The simulator
 * acts only through the same services the REST controllers call; the test never performs a driver
 * action itself.
 */
class RideSimulatorIntegrationTest extends AbstractRideIntegrationTest {

  private static final String SIM_PHONE = "+963937911111";

  @Autowired private DriverAvailabilityService driverAvailabilityService;
  @Autowired private DriverLocationService driverLocationService;
  @Autowired private DriverRideService driverRideService;
  @Autowired private RoutingProvider routingProvider;

  @Test
  @DisplayName("the simulator drives the whole loop unattended, twice, truthfully")
  void shouldDriveTheWholeLoopUnattended() {
    // An approved driver that is OFFLINE with NO position: the simulator must do all of it.
    Account sim = approvedDriver(SIM_PHONE, "SIM-1", economy, admin);
    DevRideSimulator simulator =
        new DevRideSimulator(
            new RideSimProperties(true, 1000, 3600, 1, 1, List.of(SIM_PHONE), 33.515, 36.28),
            jdbcTemplate,
            driverAvailabilityService,
            driverLocationService,
            driverRideService,
            routingProvider,
            CLOCK);
    Account rider = rider();

    UUID first = runRide(simulator, rider);
    UUID second = runRide(simulator, rider); // the harness is reusable ride after ride

    assertThat(first).isNotEqualTo(second);
    for (UUID rideId : List.of(first, second)) {
      // Admin detail: the full truth (UC-A-18) — timeline, offers trail, trace, fare.
      JsonNode detail = ok(get("/api/v1/admin/rides/" + rideId, admin), HttpStatus.OK);
      assertThat(detail.get("driverUserId").asText()).isEqualTo(sim.userId().toString());
      assertThat(detail.get("offers")).hasSize(1);
      assertThat(detail.get("offers").get(0).get("response").asText()).isEqualTo("accepted");
      JsonNode timeline = detail.get("ride").get("timeline");
      for (String reached :
          List.of(
              "requestedAt",
              "offeringAt",
              "acceptedAt",
              "driverArrivedAt",
              "startedAt",
              "completedAt")) {
        assertThat(timeline.get(reached).isNull()).as(reached).isFalse();
      }
      // Both legs were really driven: traced to_pickup AND in_ride.
      for (String phase : List.of("to_pickup", "in_ride")) {
        assertThat(
                jdbcTemplate.queryForObject(
                    "SELECT count(*) FROM ride_traces WHERE ride_id = ? AND phase = ?",
                    Integer.class,
                    rideId,
                    phase))
            .as(phase)
            .isPositive();
      }
      // The stored fare is complete and what the receipt renders from.
      JsonNode fare = detail.get("ride").get("fare");
      assertThat(fare.get("distanceMeters").asLong()).isPositive();
      assertThat(fare.get("components").get("total").decimalValue()).isPositive();
      JsonNode receipt =
          ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
      assertThat(receipt.get("fare")).isEqualTo(fare);
    }

    // Rider history shows both simulated rides like any others.
    JsonNode history = ok(get("/api/v1/rides", rider.token()), HttpStatus.OK);
    assertThat(history.get("totalItems").asLong()).isEqualTo(2);
  }

  /**
   * Books and lets the simulator do everything; returns once cash is confirmed. The simulator ticks
   * before each dispatch pass — like the dev stack, where drivers are online and streaming before a
   * booking's first dispatch tick (zero candidates ends a ride no_driver_found at once).
   */
  private UUID runRide(DevRideSimulator simulator, Account rider) {
    UUID rideId = book(rider);
    for (int tick = 0; tick < 60 && !"paid_cash".equals(paymentStatus(rideId)); tick++) {
      advance(Duration.ofSeconds(1));
      simulator.tick();
      dispatch();
    }
    assertThat(stateOf(rideId)).as("ride state after the simulated loop").isEqualTo("completed");
    assertThat(paymentStatus(rideId)).isEqualTo("paid_cash");
    return rideId;
  }

  private String paymentStatus(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_status FROM rides WHERE ride_id = ?", String.class, rideId);
  }
}
