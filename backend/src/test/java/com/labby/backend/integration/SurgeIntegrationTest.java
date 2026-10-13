package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.SurgeService;
import com.labby.backend.util.RbacIds;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.config.ScheduledTaskHolder;

/**
 * M9-T1 acceptance (PRC-02, DRV-09, UC-A-09, UC-D-14): the surge cycle counts open requests vs idle
 * online drivers per zone by the dispatch rules (stale, busy, open-offer, offline and floor-blocked
 * drivers excluded), maps the ratio to the capped step, wins overlapping zones by the highest
 * value, applies an override (and its reset) at the next cycle only, resets draft regions' zones,
 * and is idempotent (concurrency: {@link SurgeCycleIntegrationTest}); the admin state carries the
 * heatmap's level and the effective cap; bookings and retries lock the value the rider was shown
 * (409 {@code surge_changed} otherwise) and the lock survives cycles, re-dispatch and completion.
 */
class SurgeIntegrationTest extends AbstractRideIntegrationTest {

  /** The "Center" zone around the standard pickup (33.50, 36.30). */
  private static final Map<String, Object> CENTER = square(36.25, 33.45, 36.35, 33.55);

  /** Inside the region, outside {@link #CENTER}. */
  private static final double OUT_LAT = 33.58;

  private static final double OUT_LNG = 36.38;

  @Autowired private SurgeService surgeService;
  @Autowired private List<ScheduledTaskHolder> scheduledTaskHolders;

  private static Map<String, Object> square(
      double minLng, double minLat, double maxLng, double maxLat) {
    return Map.of(
        "type",
        "Polygon",
        "coordinates",
        List.of(
            List.of(
                List.of(minLng, minLat),
                List.of(maxLng, minLat),
                List.of(maxLng, maxLat),
                List.of(minLng, maxLat),
                List.of(minLng, minLat))));
  }

  private static List<Map<String, Object>> defaultSteps() {
    return List.of(
        Map.of("ratio", 2, "multiplier", 1.2),
        Map.of("ratio", 3, "multiplier", 1.5),
        Map.of("ratio", 5, "multiplier", 2.0));
  }

  /** Draws a zone through the admin API; returns its id. */
  private UUID zone(
      String name, Map<String, Object> polygon, List<Map<String, Object>> steps, Double cap) {
    Map<String, Object> body = new HashMap<>();
    body.put("name", name);
    body.put("polygon", polygon);
    body.put("thresholdSteps", steps);
    body.put("multiplierCap", cap);
    JsonNode created =
        ok(
            post("/api/v1/admin/regions/" + regionId + "/surge-zones", body, admin),
            HttpStatus.CREATED);
    return UUID.fromString(created.get("id").asText());
  }

  private UUID centerZone() {
    return zone("Center", CENTER, defaultSteps(), null);
  }

  private JsonNode surgeState() {
    return ok(get("/api/v1/admin/regions/" + regionId + "/surge-state", admin), HttpStatus.OK);
  }

  private JsonNode zoneState(String name) {
    for (JsonNode zone : surgeState().get("zones")) {
      if (zone.get("name").asText().equals(name)) {
        return zone;
      }
    }
    throw new AssertionError("no zone " + name);
  }

  private JsonNode estimate(Account rider, double lat, double lng) {
    return ok(
        post(
            "/api/v1/rides/estimate",
            Map.of("pickup", place(lat, lng), "destination", place(DEST_LAT, DEST_LNG)),
            rider.token()),
        HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> override(UUID zoneId, Object multiplier, String token) {
    return put(
        "/api/v1/admin/surge-zones/" + zoneId + "/override",
        Map.of("multiplier", multiplier),
        token);
  }

  private Map<String, Object> bookingExpecting(String expected) {
    Map<String, Object> body = booking(List.of());
    body.put("expectedSurgeMultiplier", new BigDecimal(expected));
    return body;
  }

  private UUID bookedId(ResponseEntity<JsonNode> response) {
    return UUID.fromString(ok(response, HttpStatus.CREATED).get("id").asText());
  }

  private BigDecimal lockedSurge(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT surge_multiplier FROM rides WHERE ride_id = ?", BigDecimal.class, rideId);
  }

  @Test
  @DisplayName("PRC-02: demand/supply by the dispatch rules → step; outside the zone = 1.0")
  void shouldCountDemandAndSupplyAndMapToStep() {
    UUID centerId = centerZone();

    // Busy: an accepted ride binds the driver (the ride itself is no longer open demand).
    Account busy = driverAt(PICKUP_LAT, PICKUP_LNG);
    dispatchAndAccept(book(rider()), busy);
    // Open offer: the next request is offered to this driver (the ride is `offering` = demand).
    Account offered = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID offeringRide = book(rider());
    dispatch();
    assertThat(stateOf(offeringRide)).isEqualTo("offering");
    assertThat(hasOpenOffer(offered)).isTrue();

    Account idle = driverAt(33.51, 36.29); // fresh, idle, in the zone, no balance row (= 0)
    Account stale = driverAt(33.49, 36.31);
    jdbcTemplate.update(
        "UPDATE driver_locations SET received_at = received_at - interval '10 minutes'"
            + " WHERE user_id = ?",
        stale.userId());
    Account offline = driverAt(33.49, 36.29);
    ok(put("/api/v1/driver/availability", Map.of("online", false), offline.token()), HttpStatus.OK);
    Account blocked = driverAt(33.51, 36.31);
    ok(
        post(
            "/api/v1/admin/drivers/" + blocked.userId() + "/settlements",
            Map.of("amount", "50.00", "direction", "pay_out", "currency", "SYP"),
            admin),
        HttpStatus.CREATED); // balance −50 = the default floor → blocked
    driverAt(OUT_LAT, OUT_LNG); // idle, but outside the zone
    Account noVehicle = driverAt(33.51, 36.29); // idle in the zone, but no active vehicle
    jdbcTemplate.update(
        "UPDATE vehicles SET is_active = false WHERE driver_user_id = ?", noVehicle.userId());

    Account requester = rider();
    book(requester); // `requested` in the zone
    Account outsider = rider();
    Map<String, Object> outside = booking(List.of());
    outside.put("pickup", place(OUT_LAT, OUT_LNG));
    outside.put("destination", place(33.57, 36.37));
    ok(tryBook(outsider, outside), HttpStatus.CREATED); // demand outside the zone

    assertThat(surgeService.recompute()).isEqualTo(new SurgeService.CycleResult(1, 0, 0));

    // Demand 2 (offering + requested) / supply 1 (only the idle driver) = 2.00 → the 1.2 step.
    JsonNode state = zoneState("Center");
    assertThat(state.get("id").asText()).isEqualTo(centerId.toString());
    assertThat(state.get("demandCount").asInt()).isEqualTo(2);
    assertThat(state.get("supplyCount").asInt()).isEqualTo(1);
    assertThat(state.get("computedMultiplier").decimalValue()).isEqualByComparingTo("1.20");
    assertThat(state.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.20");
    assertThat(state.get("overridePending").asBoolean()).isFalse();
    assertThat(state.get("level").asInt()).isEqualTo(1); // the heatmap's level below
    assertThat(state.get("effectiveCap").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(state.get("computedAt").isNull()).isFalse();
    assertThat(surgeState().get("surgeCap").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(surgeState().get("nextCycleAt").isNull()).isTrue(); // the cycle cron is "-"

    // The estimate reads the pickup zone; outside every zone there is no surge.
    JsonNode inside = estimate(rider(), PICKUP_LAT, PICKUP_LNG);
    assertThat(inside.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.20");
    assertThat(inside.get("surgeActive").asBoolean()).isTrue();
    assertThat(inside.get("surgeZoneName").asText()).isEqualTo("Center");
    JsonNode beyond = estimate(rider(), OUT_LAT, OUT_LNG);
    assertThat(beyond.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(beyond.get("surgeActive").asBoolean()).isFalse();
    assertThat(beyond.get("surgeZoneName").isNull()).isTrue();

    // The heatmap shows the same level without the raw counts.
    JsonNode heatmap = ok(get("/api/v1/driver/heatmap", idle.token()), HttpStatus.OK);
    assertThat(heatmap.get("regionId").asText()).isEqualTo(regionId.toString());
    assertThat(heatmap.get("computedAt").isNull()).isFalse();
    JsonNode heat = heatmap.get("zones").get(0);
    assertThat(heat.get("name").asText()).isEqualTo("Center");
    assertThat(heat.get("multiplier").decimalValue()).isEqualByComparingTo("1.20");
    assertThat(heat.get("level").asInt()).isEqualTo(1);
    assertThat(heat.get("polygon").get("type").asText()).isEqualTo("Polygon");
    assertThat(heat.has("demandCount")).isFalse();
    assertThat(heat.has("supplyCount")).isFalse();

    // Idempotent: the same inputs give the same state.
    JsonNode before = zoneState("Center");
    surgeService.recompute();
    JsonNode after = zoneState("Center");
    assertThat(after.get("demandCount")).isEqualTo(before.get("demandCount"));
    assertThat(after.get("supplyCount")).isEqualTo(before.get("supplyCount"));
    assertThat(after.get("currentMultiplier").decimalValue())
        .isEqualByComparingTo(before.get("currentMultiplier").decimalValue());
  }

  @Test
  @DisplayName("PRC-02: no supply → top step, capped by zone/region cap; overlaps → highest")
  void shouldCapTopStepAndPickHighestOverlappingZone() {
    UUID centerId = zone("Center", CENTER, defaultSteps(), 1.3);
    zone(
        "Inner",
        square(36.28, 33.48, 36.32, 33.52),
        List.of(Map.of("ratio", 1, "multiplier", 1.1)),
        null);
    book(rider()); // demand 1, no driver at all

    surgeService.recompute();
    JsonNode center = zoneState("Center");
    assertThat(center.get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.30"); // top step 2.0, zone cap 1.30
    assertThat(center.get("effectiveCap").decimalValue()).isEqualByComparingTo("1.30");
    assertThat(center.get("level").asInt()).isEqualTo(1); // 1.2 reached, 1.5 not
    JsonNode inner = zoneState("Inner");
    assertThat(inner.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.10");
    assertThat(inner.get("effectiveCap").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(inner.get("level").asInt()).isEqualTo(1);
    JsonNode quote = estimate(rider(), PICKUP_LAT, PICKUP_LNG);
    assertThat(quote.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.30");
    assertThat(quote.get("surgeZoneName").asText()).isEqualTo("Center");

    // Without a zone cap the (lower) region cap binds.
    jdbcTemplate.update(
        "UPDATE surge_zones SET multiplier_cap = NULL WHERE surge_zone_id = ?", centerId);
    jdbcTemplate.update("UPDATE regions SET surge_cap = 1.40 WHERE region_id = ?", regionId);
    surgeService.recompute();
    assertThat(zoneState("Center").get("computedMultiplier").decimalValue())
        .isEqualByComparingTo("1.40");
    assertThat(zoneState("Center").get("effectiveCap").decimalValue()).isEqualByComparingTo("1.40");
    assertThat(zoneState("Center").get("level").asInt()).isEqualTo(1);

    // Zones of a draft region are reset to no surge (counts 0) and keep their override, so a
    // reactivated region never prices a stale surge (owner-approved M9 audit I4; this used to
    // assert that draft zones keep their last state).
    ok(override(centerId, 1.3, admin), HttpStatus.OK);
    jdbcTemplate.update("UPDATE regions SET state = 'draft' WHERE region_id = ?", regionId);
    assertThat(surgeService.recompute().processed()).isZero();
    for (String name : List.of("Center", "Inner")) {
      JsonNode reset = zoneState(name);
      assertThat(reset.get("computedMultiplier").decimalValue()).isEqualByComparingTo("1.00");
      assertThat(reset.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.00");
      assertThat(reset.get("demandCount").asInt()).isZero();
      assertThat(reset.get("supplyCount").asInt()).isZero();
      assertThat(reset.get("level").asInt()).isZero();
    }
    assertThat(zoneState("Center").get("overrideMultiplier").decimalValue())
        .isEqualByComparingTo("1.30");
    jdbcTemplate.update("UPDATE regions SET state = 'active' WHERE region_id = ?", regionId);
    assertThat(estimate(rider(), PICKUP_LAT, PICKUP_LNG).get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("1.00"); // reactivated: no stale surge before the cycle
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.30"); // the kept override applies at the next cycle
  }

  @Test
  @DisplayName("DRV-09: any surge is at least level 1 (cap or override below the first step)")
  void shouldShowLevelOneBelowTheFirstStep() {
    zone("Center", CENTER, defaultSteps(), 1.1); // the cap sits below the first step (1.2)
    UUID outerId = zone("Outer", square(36.36, 33.56, 36.39, 33.59), defaultSteps(), null);
    Account driver = driverAt(OUT_LAT, OUT_LNG); // supply in Outer only
    book(rider()); // Center: demand 1, no supply → top step 2.0, capped at 1.10
    ok(override(outerId, 1.1, admin), HttpStatus.OK); // below the first step too

    surgeService.recompute();
    JsonNode center = zoneState("Center");
    assertThat(center.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.10");
    assertThat(center.get("effectiveCap").decimalValue()).isEqualByComparingTo("1.10");
    assertThat(center.get("level").asInt()).isEqualTo(1);
    JsonNode outer = zoneState("Outer");
    assertThat(outer.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.10");
    assertThat(outer.get("computedMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(outer.get("level").asInt()).isEqualTo(1);

    JsonNode heatmap = ok(get("/api/v1/driver/heatmap", driver.token()), HttpStatus.OK);
    assertThat(heatmap.get("zones")).hasSize(2);
    for (JsonNode heat : heatmap.get("zones")) {
      assertThat(heat.get("multiplier").decimalValue()).isEqualByComparingTo("1.10");
      assertThat(heat.get("level").asInt()).as(heat.get("name").asText()).isEqualTo(1);
    }
  }

  @Test
  @DisplayName(
      "UC-A-09: an override wins at the next cycle (not before); reset returns to computed")
  void shouldApplyOverrideAndResetAtTheNextCycle() {
    UUID centerId = centerZone();
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.00");

    JsonNode set = ok(override(centerId, 1.5, admin), HttpStatus.OK);
    assertThat(set.get("overrideMultiplier").decimalValue()).isEqualByComparingTo("1.50");
    JsonNode pending = zoneState("Center");
    assertThat(pending.get("overrideMultiplier").decimalValue()).isEqualByComparingTo("1.50");
    assertThat(pending.get("overrideSetAt").isNull()).isFalse();
    assertThat(pending.get("overridePending").asBoolean()).isTrue();
    assertThat(pending.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(estimate(rider(), PICKUP_LAT, PICKUP_LNG).get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("1.00"); // not before the cycle

    surgeService.recompute();
    JsonNode applied = zoneState("Center");
    assertThat(applied.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.50");
    assertThat(applied.get("computedMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(applied.get("overridePending").asBoolean()).isFalse();
    assertThat(estimate(rider(), PICKUP_LAT, PICKUP_LNG).get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("1.50");

    // A cap lowered below the override binds it at the next cycle (UC-A-09: within the cap).
    Map<String, Object> capped = new HashMap<>();
    capped.put("name", "Center");
    capped.put("polygon", CENTER);
    capped.put("thresholdSteps", defaultSteps());
    capped.put("multiplierCap", 1.3);
    ok(put("/api/v1/admin/surge-zones/" + centerId, capped, admin), HttpStatus.OK);
    assertThat(zoneState("Center").get("overridePending").asBoolean()).isTrue();
    surgeService.recompute();
    JsonNode clamped = zoneState("Center");
    assertThat(clamped.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.30");
    assertThat(clamped.get("overrideMultiplier").decimalValue()).isEqualByComparingTo("1.50");
    assertThat(clamped.get("overridePending").asBoolean()).isFalse();
    capped.remove("multiplierCap");
    ok(put("/api/v1/admin/surge-zones/" + centerId, capped, admin), HttpStatus.OK);
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.50");

    assertThat(delete("/api/v1/admin/surge-zones/" + centerId + "/override", admin).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    JsonNode reset = zoneState("Center");
    assertThat(reset.get("overrideMultiplier").isNull()).isTrue();
    assertThat(reset.get("overridePending").asBoolean()).isTrue();
    assertThat(reset.get("currentMultiplier").decimalValue()).isEqualByComparingTo("1.50");
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.00");
    assertThat(zoneState("Center").get("overridePending").asBoolean()).isFalse();

    assertThat(auditActions(centerId.toString()))
        .containsSubsequence(
            "surge_zone.create", "surge_zone.override_set", "surge_zone.override_reset");
    Map<String, Object> audit =
        jdbcTemplate.queryForMap(
            "SELECT before_state::text AS before, after_state::text AS after FROM audit_log"
                + " WHERE action = 'surge_zone.override_set' AND target_id = ?",
            centerId.toString());
    assertThat(audit.get("before").toString()).contains("\"overrideMultiplier\": null");
    assertThat(audit.get("after").toString()).contains("1.5");

    // Editing the zone config never touches the override.
    ok(override(centerId, 1.2, admin), HttpStatus.OK);
    Map<String, Object> edit = new HashMap<>();
    edit.put("name", "Center");
    edit.put("polygon", CENTER);
    edit.put("thresholdSteps", defaultSteps());
    ok(put("/api/v1/admin/surge-zones/" + centerId, edit, admin), HttpStatus.OK);
    assertThat(zoneState("Center").get("overrideMultiplier").decimalValue())
        .isEqualByComparingTo("1.20");
  }

  @Test
  @DisplayName("UC-A-09: override bounds 1.00..effective cap, 2 decimals; pricing:edit required")
  void shouldValidateAndGateOverride() {
    UUID centerId = zone("Center", CENTER, defaultSteps(), 1.8); // region cap 2.00
    ResponseEntity<JsonNode> aboveCap = override(centerId, 1.9, admin);
    assertThat(aboveCap.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(code(aboveCap)).isEqualTo("override_above_cap");
    assertThat(aboveCap.getBody().get("details").get("cap").decimalValue())
        .isEqualByComparingTo("1.80");
    assertThat(override(centerId, 0.99, admin).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(override(centerId, 1.234, admin).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    ok(override(centerId, 1.8, admin), HttpStatus.OK); // exactly the cap

    JsonNode role =
        ok(
            post(
                "/api/v1/admin/roles",
                Map.of("name", "Pricing Viewer", "permissions", List.of("pricing:view")),
                admin),
            HttpStatus.CREATED);
    String viewer = registerAdmin("+963937800001", UUID.fromString(role.get("id").asText()));
    assertThat(override(centerId, 1.5, viewer).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            delete("/api/v1/admin/surge-zones/" + centerId + "/override", viewer).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    ok(get("/api/v1/admin/regions/" + regionId + "/surge-state", viewer), HttpStatus.OK);
    String support = registerAdmin("+963937800002", RbacIds.SUPPORT_ROLE_ID);
    assertThat(get("/api/v1/admin/regions/" + regionId + "/surge-state", support).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(auditActions(centerId.toString())).containsOnlyOnce("surge_zone.override_set");
  }

  @Test
  @DisplayName("PRC-02: booking locks the shown value (409 surge_changed otherwise); immutable")
  void shouldLockSurgeAtBookingThroughCompletion() {
    UUID centerId = centerZone();
    ok(override(centerId, 1.5, admin), HttpStatus.OK);
    surgeService.recompute();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();

    // Like every multiplier, the expectation is ≥ 1.00 with at most 2 decimals.
    assertThat(tryBook(rider, bookingExpecting("0.50")).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(tryBook(rider, bookingExpecting("1.505")).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    ResponseEntity<JsonNode> changed = tryBook(rider, bookingExpecting("1.20"));
    assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(changed)).isEqualTo("surge_changed");
    assertThat(changed.getBody().get("details").get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("1.50");

    UUID rideId = bookedId(tryBook(rider, bookingExpecting("1.5")));
    assertThat(riderRide(rider, rideId).get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("1.50");
    JsonNode offer = dispatchAndAccept(rideId, driver);
    assertThat(offer.get("id").asText()).isEqualTo(rideId.toString());

    // The cycle drops the zone to 1.0 mid-ride; the ride keeps its lock.
    delete("/api/v1/admin/surge-zones/" + centerId + "/override", admin);
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("1.00");
    assertThat(lockedSurge(rideId)).isEqualByComparingTo("1.50");

    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    Map<String, Object> fare =
        jdbcTemplate.queryForMap(
            "SELECT surge_multiplier, surge_amount FROM fares WHERE ride_id = ?", rideId);
    assertThat((BigDecimal) fare.get("surge_multiplier")).isEqualByComparingTo("1.50");
    assertThat((BigDecimal) fare.get("surge_amount")).isPositive();
  }

  @Test
  @DisplayName("PRC-02: without an expectation the current value is locked; re-dispatch keeps it")
  void shouldKeepLockOnRedispatch() {
    UUID centerId = centerZone();
    ok(override(centerId, 1.5, admin), HttpStatus.OK);
    surgeService.recompute();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();
    UUID rideId = book(rider); // no expectedSurgeMultiplier: backward compatible
    assertThat(lockedSurge(rideId)).isEqualByComparingTo("1.50");
    dispatchAndAccept(rideId, driver);

    delete("/api/v1/admin/surge-zones/" + centerId + "/override", admin);
    surgeService.recompute();
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "vehicle_issue"),
            driver.token()),
        HttpStatus.OK);
    UUID redispatched =
        UUID.fromString(riderRide(rider, rideId).get("redispatchedAsRideId").asText());
    assertThat(lockedSurge(redispatched)).isEqualByComparingTo("1.50");
  }

  @Test
  @DisplayName("RIDE-08 / PRC-02: retry expects the surge the rider saw (409 surge_changed)")
  void shouldNotLockAnUnseenSurgeOnRetry() {
    centerZone();
    surgeService.recompute(); // Center at 1.00
    Account rider = rider();
    UUID rideId = book(rider);
    dispatch(); // no driver at all
    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");

    // The zone rises before the rider taps "Try again": demand without supply → the top step.
    book(rider());
    surgeService.recompute();
    assertThat(zoneState("Center").get("currentMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");

    String retry = "/api/v1/rides/" + rideId + "/retry";
    ResponseEntity<JsonNode> changed = post(retry, null, rider.token());
    assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(changed)).isEqualTo("surge_changed");
    assertThat(changed.getBody().get("details").get("surgeMultiplier").decimalValue())
        .isEqualByComparingTo("2.00");
    assertThat(ridesOf(rider)).isEqualTo(1); // no ride created
    ResponseEntity<JsonNode> stale =
        post(retry, Map.of("expectedSurgeMultiplier", new BigDecimal("1.00")), rider.token());
    assertThat(code(stale)).isEqualTo("surge_changed");
    assertThat(
            post(retry, Map.of("expectedSurgeMultiplier", new BigDecimal("0.5")), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(ridesOf(rider)).isEqualTo(1);

    // Confirmed at the new value: locked at it.
    UUID retried =
        bookedId(
            post(retry, Map.of("expectedSurgeMultiplier", new BigDecimal("2.0")), rider.token()));
    assertThat(lockedSurge(retried)).isEqualByComparingTo("2.00");
    assertThat(riderRide(rider, retried).get("retryOfRideId").asText())
        .isEqualTo(rideId.toString());
  }

  @Test
  @DisplayName("RIDE-08 / PRC-02: retry without a body re-locks the unchanged previous surge")
  void shouldRetryAtThePreviousSurgeWhenUnchanged() {
    UUID centerId = centerZone();
    ok(override(centerId, 1.5, admin), HttpStatus.OK);
    surgeService.recompute();
    Account rider = rider();
    UUID rideId = bookedId(tryBook(rider, bookingExpecting("1.50")));
    dispatch();
    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");

    UUID retried = bookedId(post("/api/v1/rides/" + rideId + "/retry", null, rider.token()));
    assertThat(lockedSurge(retried)).isEqualByComparingTo("1.50");
  }

  private int ridesOf(Account rider) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM rides WHERE rider_user_id = ?", Integer.class, rider.userId());
  }

  @Test
  @DisplayName("UC-D-14: heatmap needs an operating region (404); the job is off with \"-\"")
  void shouldRefuseHeatmapWithoutRegionAndDisableJob() {
    centerZone();
    Account unlocated = approvedDriver("+963937800003", "RD-NOLOC", economy, admin);
    ResponseEntity<JsonNode> none = get("/api/v1/driver/heatmap", unlocated.token());
    assertThat(none.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(code(none)).isEqualTo("no_operating_region");
    assertThat(get("/api/v1/driver/heatmap", rider().token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    Account located = driverAt(PICKUP_LAT, PICKUP_LNG);
    JsonNode heatmap = ok(get("/api/v1/driver/heatmap", located.token()), HttpStatus.OK);
    assertThat(heatmap.get("computedAt").isNull()).isTrue(); // no cycle yet
    assertThat(heatmap.get("zones").get(0).get("level").asInt()).isZero();

    assertThat(scheduledTaskHolders)
        .flatMap(ScheduledTaskHolder::getScheduledTasks)
        .noneMatch(task -> task.getTask().getRunnable().toString().contains("SurgeCycleJob"));
  }
}
