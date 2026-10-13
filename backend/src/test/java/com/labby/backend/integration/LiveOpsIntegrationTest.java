package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * M10-T2 acceptance — the live ops map feed (ADM-03, UC-A-19): fresh online driver dots (idle vs
 * on-ride, stale excluded), active rides with the open-SOS red flag, the M9 surge overlay, open SOS
 * pins and the poll pace — gated by {@code rides:view}.
 */
class LiveOpsIntegrationTest extends AbstractRideIntegrationTest {

  private JsonNode snapshot() {
    return ok(get("/api/v1/admin/regions/" + regionId + "/live-ops", admin), HttpStatus.OK);
  }

  private static JsonNode driverIn(JsonNode snapshot, UUID driverUserId) {
    for (JsonNode driver : snapshot.get("drivers")) {
      if (driver.get("driverUserId").asText().equals(driverUserId.toString())) {
        return driver;
      }
    }
    return null;
  }

  @Test
  @DisplayName("ADM-03: idle vs on-ride dots, stale drivers excluded, rides carry the SOS flag")
  void shouldSnapshotRegion() {
    // One surge zone so the overlay is present (same shape as the M9 surge state).
    Map<String, Object> zone = new HashMap<>();
    zone.put("name", "Center");
    zone.put(
        "polygon",
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
                    List.of(36.25, 33.45)))));
    zone.put("thresholdSteps", List.of(Map.of("ratio", 2, "multiplier", 1.2)));
    UUID zoneId =
        UUID.fromString(
            ok(
                    post("/api/v1/admin/regions/" + regionId + "/surge-zones", zone, admin),
                    HttpStatus.CREATED)
                .get("id")
                .asText());

    Account rider = rider();
    Account idle = driverAt(33.505, 36.305);
    Account onRide = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, onRide);

    JsonNode snapshot = snapshot();
    assertThat(snapshot.get("regionId").asText()).isEqualTo(regionId.toString());
    assertThat(snapshot.get("refreshSeconds").asInt()).isEqualTo(5);
    JsonNode idleDot = driverIn(snapshot, idle.userId());
    assertThat(idleDot.get("status").asText()).isEqualTo("idle");
    assertThat(idleDot.get("rideId").isNull()).isTrue();
    assertThat(idleDot.get("name").asText()).startsWith("Driver");
    JsonNode onRideDot = driverIn(snapshot, onRide.userId());
    assertThat(onRideDot.get("status").asText()).isEqualTo("on_ride");
    assertThat(onRideDot.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(onRideDot.get("lat").asDouble()).isEqualTo(33.501);

    // The active ride with its route facts; no SOS yet.
    assertThat(snapshot.get("rides")).hasSize(1);
    JsonNode ride = snapshot.get("rides").get(0);
    assertThat(ride.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(ride.get("state").asText()).isEqualTo("accepted");
    assertThat(ride.get("pickup").get("lat").asDouble()).isEqualTo(PICKUP_LAT);
    assertThat(ride.get("destination").get("lng").asDouble()).isEqualTo(DEST_LNG);
    assertThat(ride.get("driverUserId").asText()).isEqualTo(onRide.userId().toString());
    assertThat(ride.get("sosOpen").asBoolean()).isFalse();
    assertThat(snapshot.get("sosEvents")).isEmpty();

    // The surge overlay carries the zone's current multiplier and level.
    assertThat(snapshot.get("surgeZones")).hasSize(1);
    JsonNode overlay = snapshot.get("surgeZones").get(0);
    assertThat(overlay.get("id").asText()).isEqualTo(zoneId.toString());
    assertThat(overlay.get("multiplier").asDouble()).isEqualTo(1.0);
    assertThat(overlay.get("level").asInt()).isZero();
    assertThat(overlay.get("polygon").get("type").asText()).isEqualTo("Polygon");

    // An SOS flips the ride red and lands as an open pin.
    ok(
        post(
            "/api/v1/rides/" + rideId + "/sos",
            Map.of("lat", 33.501, "lng", 36.30, "recordedAt", CLOCK.instant().toString()),
            rider.token()),
        HttpStatus.CREATED);
    JsonNode flagged = snapshot();
    assertThat(flagged.get("rides").get(0).get("sosOpen").asBoolean()).isTrue();
    assertThat(flagged.get("sosEvents")).hasSize(1);
    assertThat(flagged.get("sosEvents").get(0).get("rideId").asText()).isEqualTo(rideId.toString());

    // A driver whose stream went stale drops off the map (the realtime staleness window);
    // the on-ride driver keeps streaming.
    advance(Duration.ofSeconds(31));
    position(onRide, 33.5015, 36.3005);
    JsonNode afterStale = snapshot();
    assertThat(driverIn(afterStale, idle.userId())).isNull();
    assertThat(driverIn(afterStale, onRide.userId())).isNotNull();
  }

  @Test
  @DisplayName("the feed needs rides:view; an unknown region is 404")
  void shouldGateSnapshot() {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('No rides', false) RETURNING role_id",
            UUID.class);
    String powerless = registerAdmin("+963937903001", roleId);
    assertThat(get("/api/v1/admin/regions/" + regionId + "/live-ops", powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/regions/" + regionId + "/live-ops", rider().token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            get("/api/v1/admin/regions/" + UUID.randomUUID() + "/live-ops", admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }
}
