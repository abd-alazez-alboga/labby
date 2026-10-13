package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.config.RideSimProperties;
import com.labby.backend.runner.DevRideSimulator;
import com.labby.backend.service.DriverAvailabilityService;
import com.labby.backend.service.DriverLocationService;
import com.labby.backend.service.DriverRideService;
import com.labby.backend.service.RoutingProvider;
import com.labby.backend.service.SurgeService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M9-T3 acceptance — surge end to end on the dev driver-simulation harness: the simulator is the
 * zone's only supply and performs every driver action; the test acts only as riders and the admin
 * over REST and runs the surge cycle on the controlled clock. A flood of requests steps the zone up
 * 1.2× → 1.5× → 2.0× (one number everywhere: estimate, driver heatmap, admin state); a booking
 * locks the raised value (a stale expectation gets 409 {@code surge_changed}); draining the demand
 * decays the zone back to 1.0× while the ride keeps its lock; completion bills the locked surge,
 * itemized identically on the stored fare, the rider receipt, the admin detail and the driver
 * ledger; a manual override goes live at the next cycle, bills, and resets the same way.
 */
class SurgeSimulatorIntegrationTest extends AbstractRideIntegrationTest {

  private static final String SIM_PHONE = "+963937911111";

  /** Around the standard pickup (33.50, 36.30) and destination (33.51, 36.31). */
  private static final Map<String, Object> ZONE =
      Map.of(
          "type",
          "Polygon",
          "coordinates",
          List.of(
              List.of(
                  List.of(36.25, 33.45),
                  List.of(36.35, 33.45),
                  List.of(36.35, 33.55),
                  List.of(36.25, 33.55),
                  List.of(36.25, 33.45))));

  @Autowired private DriverAvailabilityService driverAvailabilityService;
  @Autowired private DriverLocationService driverLocationService;
  @Autowired private DriverRideService driverRideService;
  @Autowired private RoutingProvider routingProvider;
  @Autowired private SurgeService surgeService;

  private Account sim;
  private DevRideSimulator simulator;
  private UUID zoneId;
  private final Map<UUID, Account> floodRiders = new HashMap<>();

  @BeforeEach
  void startSimulatorAndZone() {
    sim = approvedDriver(SIM_PHONE, "SIM-1", economy, admin);
    simulator =
        new DevRideSimulator(
            new RideSimProperties(
                true, 1000, 3600, 1, 1, List.of(SIM_PHONE), PICKUP_LAT, PICKUP_LNG),
            jdbcTemplate,
            driverAvailabilityService,
            driverLocationService,
            driverRideService,
            routingProvider,
            CLOCK);
    Map<String, Object> body = new HashMap<>();
    body.put("name", "Mazzeh");
    body.put("polygon", ZONE);
    body.put(
        "thresholdSteps",
        List.of(
            Map.of("ratio", 2, "multiplier", 1.2),
            Map.of("ratio", 3, "multiplier", 1.5),
            Map.of("ratio", 5, "multiplier", 2.0)));
    zoneId =
        UUID.fromString(
            ok(
                    post("/api/v1/admin/regions/" + regionId + "/surge-zones", body, admin),
                    HttpStatus.CREATED)
                .get("id")
                .asText());
    idle(); // the simulator is online, streaming and idle in the zone: supply 1
  }

  @Test
  @DisplayName("PRC-02: a flood steps the zone up, one number everywhere; booking locks it")
  void shouldStepUpAndLockTheRaisedMultiplier() {
    List<UUID> flood = new ArrayList<>();
    cycle();
    assertSurge("1.00", 0);

    flood(flood, 2);
    cycle();
    assertSurge("1.20", 1); // 2 requests / 1 free driver

    flood(flood, 1);
    cycle();
    assertSurge("1.50", 2); // 3 / 1

    flood(flood, 3);
    cycle();
    assertSurge("2.00", 3); // 6 / 1 → the top step, the region cap

    // The rider was shown 1.5 a cycle ago: refused with the live value, nothing booked.
    Account rider = rider();
    ResponseEntity<JsonNode> stale = tryBook(rider, expecting("1.5"));
    assertThat(stale.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(stale)).isEqualTo("surge_changed");
    assertThat(stale.getBody().get("details").get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");
    UUID locked = booked(tryBook(rider, expecting("2.0")));
    assertThat(riderRide(rider, locked).get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");

    // Drain: 7 open → 4 open (3 flood + the locked ride) → 1.5; then only the locked ride → 1.0.
    cancel(flood.subList(0, 3));
    cycle();
    assertSurge("1.50", 2);
    cancel(flood.subList(3, flood.size()));
    cycle();
    assertSurge("1.00", 0); // 1 / 1 — below the first step

    // The simulator takes the ride; the zone stays calm, the ride keeps its 2.0 lock.
    simulate(locked);
    cycle();
    assertSurge("1.00", 0);
    assertBilled(rider, locked, "2.00");
  }

  @Test
  @DisplayName("UC-A-09: a manual override goes live at the next cycle, bills, and resets")
  void shouldApplyBillAndResetAnOverride() {
    cycle();
    assertSurge("1.00", 0);

    ok(
        put("/api/v1/admin/surge-zones/" + zoneId + "/override", Map.of("multiplier", 1.8), admin),
        HttpStatus.OK);
    JsonNode pending = zoneState();
    assertThat(pending.get("overridePending").asBoolean()).isTrue();
    assertSurge("1.00", 0); // not before the cycle

    cycle();
    assertThat(zoneState().get("overridePending").asBoolean()).isFalse();
    assertThat(zoneState().get("computedMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertSurge("1.80", 2); // 1.2 and 1.5 reached → level 2

    Account rider = rider();
    UUID rideId = booked(tryBook(rider, expecting("1.8")));
    simulate(rideId);

    assertThat(delete("/api/v1/admin/surge-zones/" + zoneId + "/override", admin).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(zoneState().get("overridePending").asBoolean()).isTrue();
    cycle();
    assertSurge("1.00", 0);
    assertBilled(rider, rideId, "1.80");
    assertThat(auditActions(zoneId.toString()))
        .containsSubsequence(
            "surge_zone.create", "surge_zone.override_set", "surge_zone.override_reset");
  }

  // ---- harness -------------------------------------------------------------------------------

  /** One simulator tick (online + a fresh stream) so the driver counts as supply. */
  private void idle() {
    advance(Duration.ofSeconds(1));
    simulator.tick();
  }

  /** The surge cycle right after the simulator streamed (fresh supply, as on the dev stack). */
  private void cycle() {
    idle();
    surgeService.recompute();
  }

  /** {@code count} new riders book in the zone; no dispatch, so each stays open demand. */
  private void flood(List<UUID> rides, int count) {
    for (int i = 0; i < count; i++) {
      Account rider = rider();
      UUID rideId = booked(tryBook(rider, booking(List.of())));
      floodRiders.put(rideId, rider);
      rides.add(rideId);
    }
  }

  private void cancel(List<UUID> rides) {
    for (UUID rideId : rides) {
      ok(
          post(
              "/api/v1/rides/" + rideId + "/cancel",
              Map.of("reason", "changed_mind"),
              floodRiders.get(rideId).token()),
          HttpStatus.OK);
      assertThat(stateOf(rideId)).isEqualTo("cancelled_by_rider");
    }
  }

  /** The surge level must be the same number on the estimate, the heatmap and the admin state. */
  private void assertSurge(String multiplier, int level) {
    JsonNode estimate =
        ok(
            post(
                "/api/v1/rides/estimate",
                Map.of(
                    "pickup",
                    place(PICKUP_LAT, PICKUP_LNG),
                    "destination",
                    place(DEST_LAT, DEST_LNG)),
                rider().token()),
            HttpStatus.OK);
    assertThat(estimate.get("surgeMultiplier").decimalValue())
        .as("estimate")
        .isEqualByComparingTo(multiplier);
    boolean surging = new BigDecimal(multiplier).compareTo(BigDecimal.ONE) > 0;
    assertThat(estimate.get("surgeActive").asBoolean()).isEqualTo(surging);
    if (surging) {
      assertThat(estimate.get("surgeZoneName").asText()).isEqualTo("Mazzeh");
    }
    JsonNode heat = ok(get("/api/v1/driver/heatmap", sim.token()), HttpStatus.OK).get("zones");
    assertThat(heat).hasSize(1);
    assertThat(heat.get(0).get("multiplier").decimalValue())
        .as("heatmap")
        .isEqualByComparingTo(multiplier);
    assertThat(heat.get(0).get("level").asInt()).as("heatmap level").isEqualTo(level);
    assertThat(zoneState().get("currentMultiplier").decimalValue())
        .as("admin state")
        .isEqualByComparingTo(multiplier);
  }

  /**
   * PRC-04 + RIDE-06: the stored fare bills the locked surge on (subtotal + surcharge), the total
   * adds up, and the rider receipt, the admin detail and the driver ledger carry the same numbers.
   */
  private void assertBilled(Account rider, UUID rideId, String multiplier) {
    Map<String, Object> fare =
        jdbcTemplate.queryForMap("SELECT * FROM fares WHERE ride_id = ?", rideId);
    BigDecimal subtotal =
        ((BigDecimal) fare.get("base_fare"))
            .add((BigDecimal) fare.get("distance_fare"))
            .add((BigDecimal) fare.get("time_fare"));
    BigDecimal surcharge = (BigDecimal) fare.get("surcharge_amount");
    assertThat((BigDecimal) fare.get("surge_multiplier")).isEqualByComparingTo(multiplier);
    BigDecimal surge =
        subtotal
            .add(surcharge)
            .multiply(new BigDecimal(multiplier).subtract(BigDecimal.ONE))
            .setScale(2, RoundingMode.HALF_UP);
    assertThat((BigDecimal) fare.get("surge_amount")).isEqualByComparingTo(surge).isPositive();
    BigDecimal total =
        subtotal
            .add(surcharge)
            .add(surge)
            .add((BigDecimal) fare.get("wait_fare"))
            .add((BigDecimal) fare.get("pickup_fee"))
            .add((BigDecimal) fare.get("minimum_fare_adjustment"))
            .subtract((BigDecimal) fare.get("discount"));
    assertThat((BigDecimal) fare.get("total")).isEqualByComparingTo(total);

    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    JsonNode components = receipt.get("fare").get("components");
    assertThat(components.get("surgeMultiplier").decimalValue()).isEqualByComparingTo(multiplier);
    assertThat(components.get("surgeAmount").decimalValue()).isEqualByComparingTo(surge);
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo(total);
    JsonNode detail = ok(get("/api/v1/admin/rides/" + rideId, admin), HttpStatus.OK);
    assertThat(detail.get("ride").get("fare")).isEqualTo(receipt.get("fare"));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT fare_amount FROM driver_ledger WHERE ride_id = ? AND type IN"
                    + " ('ride_earning', 'commission_due')",
                BigDecimal.class,
                rideId))
        .as("the commission is taken on the surged total")
        .isEqualByComparingTo(total);
  }

  /** Lets the simulator do every driver action until the ride is settled. */
  private void simulate(UUID rideId) {
    tickUntil(
        rideId,
        () -> "completed".equals(stateOf(rideId)) && !"pending".equals(paymentStatus(rideId)));
  }

  private void tickUntil(UUID rideId, BooleanSupplier done) {
    for (int tick = 0; tick < 120; tick++) {
      advance(Duration.ofSeconds(1));
      simulator.tick();
      dispatch();
      if (done.getAsBoolean()) {
        return;
      }
    }
    throw new AssertionError(
        "ride %s stuck in %s / %s".formatted(rideId, stateOf(rideId), paymentStatus(rideId)));
  }

  private JsonNode zoneState() {
    return ok(get("/api/v1/admin/regions/" + regionId + "/surge-state", admin), HttpStatus.OK)
        .get("zones")
        .get(0);
  }

  private Map<String, Object> expecting(String multiplier) {
    Map<String, Object> body = booking(List.of());
    body.put("expectedSurgeMultiplier", new BigDecimal(multiplier));
    return body;
  }

  private UUID booked(ResponseEntity<JsonNode> response) {
    return UUID.fromString(ok(response, HttpStatus.CREATED).get("id").asText());
  }

  private String paymentStatus(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_status FROM rides WHERE ride_id = ?", String.class, rideId);
  }
}
