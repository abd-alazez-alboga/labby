package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M7-T2 acceptance — the rider side (rides-v1.yaml): estimate per service type, every booking
 * refusal with its machine code (UC-R-04 E1–E4), the RIDE-07 grace logic and recorded fees with the
 * quote endpoint, saved places (UC-R-01 incl. duplicate names), preferences (UC-R-02/03), ownership
 * (another rider's ride is a 404) and the admin permission gate (UC-A-18).
 */
class RideBookingIntegrationTest extends AbstractRideIntegrationTest {

  private Map<String, Object> with(String key, Object value) {
    Map<String, Object> body = new HashMap<>(booking(List.of()));
    body.put(key, value);
    return body;
  }

  @Test
  @DisplayName("RIDE-01: one estimate per enabled service type, labeled approximate without OSRM")
  void shouldEstimatePerServiceType() {
    jdbcTemplate.update(
        "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
            + " per_min_rate, minimum_fare, enabled) VALUES (?, 'Van', 'فان', 3, 1, 1, 5, false)",
        regionId);
    Account rider = rider();
    JsonNode estimate =
        ok(
            post(
                "/api/v1/rides/estimate",
                Map.of(
                    "pickup",
                    place(PICKUP_LAT, PICKUP_LNG),
                    "destination",
                    place(DEST_LAT, DEST_LNG),
                    "stops",
                    List.of(place(33.505, 36.305))),
                rider.token()),
            HttpStatus.OK);
    assertThat(estimate.get("regionId").asText()).isEqualTo(regionId.toString());
    assertThat(estimate.get("currency").asText()).isEqualTo("SYP");
    assertThat(estimate.get("route").get("approximate").asBoolean()).isTrue();
    assertThat(estimate.get("options")).hasSize(1); // the disabled Van is not offered
    JsonNode economyOption = estimate.get("options").get(0);
    assertThat(economyOption.get("nameAr").asText()).isEqualTo("اقتصادي");
    JsonNode components = economyOption.get("estimate").get("components");
    assertThat(components.get("total").decimalValue())
        .isGreaterThanOrEqualTo(components.get("baseFare").decimalValue());
    assertThat(estimate.get("pickupDistanceMode").asText()).isEqualTo("nearby_only");
    assertThat(estimate.get("pickupFeeRule").isNull()).isTrue();

    ResponseEntity<JsonNode> outside =
        post(
            "/api/v1/rides/estimate",
            Map.of("pickup", place(34.5, 36.3), "destination", place(DEST_LAT, DEST_LNG)),
            rider.token());
    assertThat(outside.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(outside)).isEqualTo("outside_region");
  }

  @Test
  @DisplayName("UC-R-04: every refusal carries its code; a valid booking is stored once")
  void shouldValidateBookings() {
    Account rider = rider();
    Map<String, ResponseEntity<JsonNode>> refusals = new HashMap<>();
    refusals.put("outside_region", tryBook(rider, with("pickup", place(34.5, 36.3))));
    refusals.put(
        "outside_region-destination", tryBook(rider, with("destination", place(34.5, 36.3))));
    refusals.put("outside_region-stop", tryBook(rider, booking(List.of(place(34.5, 36.3)))));
    refusals.put(
        "too_many_stops",
        tryBook(
            rider,
            booking(
                List.of(
                    place(33.501, 36.30),
                    place(33.502, 36.30),
                    place(33.503, 36.30),
                    place(33.504, 36.30)))));
    refusals.put("payment_method_unavailable", tryBook(rider, with("paymentMethod", "wallet")));
    refusals.put(
        "service_type_unavailable",
        tryBook(rider, with("serviceTypeId", UUID.randomUUID().toString())));
    for (Map.Entry<String, ResponseEntity<JsonNode>> refusal : refusals.entrySet()) {
      assertThat(refusal.getValue().getStatusCode())
          .as(refusal.getKey())
          .isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
      assertThat(code(refusal.getValue()))
          .as(refusal.getKey())
          .startsWith(refusal.getKey().split("-")[0]);
    }
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rides WHERE rider_user_id = ?",
                Integer.class,
                rider.userId()))
        .isZero();

    UUID rideId = book(rider);
    ResponseEntity<JsonNode> second = tryBook(rider, booking(List.of()));
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(second)).isEqualTo("active_ride_exists");
    assertThat(ok(get("/api/v1/rides/active", rider.token()), HttpStatus.OK).get("id").asText())
        .isEqualTo(rideId.toString());

    // Another rider's ride is a plain 404.
    Account stranger = rider();
    assertThat(get("/api/v1/rides/" + rideId, stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            post(
                    "/api/v1/rides/" + rideId + "/cancel",
                    Map.of("reason", "changed_mind"),
                    stranger.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("UC-R-04 E3: a suspended rider role cannot book (403 rider_suspended)")
  void shouldRefuseSuspendedRider() {
    Account rider = rider();
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended' WHERE user_id = ? AND role = 'rider'",
        rider.userId());
    ResponseEntity<JsonNode> refused = tryBook(rider, booking(List.of()));
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(code(refused)).isEqualTo("rider_suspended");
    assertThat(refused.getBody().get("details").has("suspensionReason")).isTrue();
  }

  @Test
  @DisplayName("RIDE-07: free before acceptance and within 2 min; a 2.00 fee is recorded after")
  void shouldApplyCancellationGrace() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);

    // Before acceptance: free.
    UUID unaccepted = book(rider);
    JsonNode quote =
        ok(
            get("/api/v1/rides/" + unaccepted + "/cancellation-quote", rider.token()),
            HttpStatus.OK);
    assertThat(quote.get("free").asBoolean()).isTrue();
    ok(
        post(
            "/api/v1/rides/" + unaccepted + "/cancel",
            Map.of("reason", "wrong_pickup"),
            rider.token()),
        HttpStatus.OK);

    // Accepted, within the grace: free, and the quote names the grace end.
    UUID withinGrace = book(rider);
    dispatchAndAccept(withinGrace, driver);
    quote =
        ok(
            get("/api/v1/rides/" + withinGrace + "/cancellation-quote", rider.token()),
            HttpStatus.OK);
    assertThat(quote.get("free").asBoolean()).isTrue();
    Instant graceEnd = Instant.parse(quote.get("graceEndsAt").asText());
    JsonNode freeCancel =
        ok(
            post(
                "/api/v1/rides/" + withinGrace + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(freeCancel.get("cancellationFee").isNull()).isTrue();
    assertThat(outboxEvents(driver.userId())).contains("ride.cancelled_by_rider");

    // Accepted, after the grace: the region fee is recorded (collected in M8).
    UUID late = book(rider);
    dispatchAndAccept(late, driver);
    advance(Duration.ofMinutes(3));
    quote = ok(get("/api/v1/rides/" + late + "/cancellation-quote", rider.token()), HttpStatus.OK);
    assertThat(quote.get("free").asBoolean()).isFalse();
    assertThat(quote.get("fee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(quote.get("currency").asText()).isEqualTo("SYP");
    assertThat(graceEnd).isBefore(CLOCK.instant());
    JsonNode charged =
        ok(
            post(
                "/api/v1/rides/" + late + "/cancel",
                Map.of("reason", "other", "note", "Plans changed"),
                rider.token()),
            HttpStatus.OK);
    assertThat(charged.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(charged.get("cancellationReason").asText()).isEqualTo("other");

    // Reasons: a driver reason or "other" without a note is a 400; in_progress cannot be cancelled.
    UUID inRide = book(rider);
    assertThat(
            post(
                    "/api/v1/rides/" + inRide + "/cancel",
                    Map.of("reason", "rider_no_show"),
                    rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post("/api/v1/rides/" + inRide + "/cancel", Map.of("reason", "other"), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    position(driver, 33.501, 36.30); // the stream went stale during the 3 minutes
    dispatchAndAccept(inRide, driver);
    arriveAndStart(inRide, driver);
    ResponseEntity<JsonNode> refused =
        post(
            "/api/v1/rides/" + inRide + "/cancel", Map.of("reason", "changed_mind"), rider.token());
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(refused.getBody().get("details").get("state").asText()).isEqualTo("in_progress");
  }

  @Test
  @DisplayName("UC-R-01: saved places CRUD; names unique per rider case-insensitively; owner-only")
  void shouldManageSavedPlaces() {
    Account rider = rider();
    JsonNode home =
        ok(
            post(
                "/api/v1/rider/saved-locations",
                Map.of("name", "Home", "lat", 33.51, "lng", 36.29, "address", "Mezzeh"),
                rider.token()),
            HttpStatus.CREATED);
    ok(
        post(
            "/api/v1/rider/saved-locations",
            Map.of("name", "Work", "lat", 33.52, "lng", 36.31),
            rider.token()),
        HttpStatus.CREATED);
    ResponseEntity<JsonNode> duplicate =
        post(
            "/api/v1/rider/saved-locations",
            Map.of("name", "HOME", "lat", 33.5, "lng", 36.3),
            rider.token());
    assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(duplicate)).isEqualTo("duplicate_name");

    JsonNode list = ok(get("/api/v1/rider/saved-locations", rider.token()), HttpStatus.OK);
    assertThat(list).hasSize(2);
    assertThat(list.get(0).get("name").asText()).isEqualTo("Home");
    assertThat(list.get(0).get("address").asText()).isEqualTo("Mezzeh");

    String homeUrl = "/api/v1/rider/saved-locations/" + home.get("id").asText();
    assertThat(
            put(homeUrl, Map.of("name", "work", "lat", 33.5, "lng", 36.3), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    JsonNode renamed =
        ok(
            put(homeUrl, Map.of("name", "Family", "lat", 33.505, "lng", 36.295), rider.token()),
            HttpStatus.OK);
    assertThat(renamed.get("lat").asDouble()).isEqualTo(33.505);

    Account stranger = rider();
    assertThat(delete(homeUrl, stranger.token()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(delete(homeUrl, rider.token()).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(ok(get("/api/v1/rider/saved-locations", rider.token()), HttpStatus.OK)).hasSize(1);
  }

  @Test
  @DisplayName("UC-R-02/03: preference defaults, replace, unknown values are a 400")
  void shouldManagePreferences() {
    Account rider = rider();
    JsonNode defaults = ok(get("/api/v1/rider/preferences", rider.token()), HttpStatus.OK);
    assertThat(defaults.get("temperature").asText()).isEqualTo("no_preference");
    assertThat(defaults.get("pickupDistanceMode").asText()).isEqualTo("nearby_only");

    Map<String, Object> body =
        Map.of(
            "temperature", "warm",
            "conversation", "chatty",
            "music", "any",
            "pickupDistanceMode", "accept_distant_fee");
    ok(put("/api/v1/rider/preferences", body, rider.token()), HttpStatus.OK);
    JsonNode saved = ok(get("/api/v1/rider/preferences", rider.token()), HttpStatus.OK);
    assertThat(saved.get("conversation").asText()).isEqualTo("chatty");
    assertThat(saved.get("pickupDistanceMode").asText()).isEqualTo("accept_distant_fee");

    Map<String, Object> bad = new HashMap<>(body);
    bad.put("music", "heavy_metal");
    assertThat(put("/api/v1/rider/preferences", bad, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    // With the distant-fee toggle the estimate shows the pickup-fee rule (UC-R-04 A3).
    JsonNode estimate =
        ok(
            post(
                "/api/v1/rides/estimate",
                Map.of(
                    "pickup",
                    place(PICKUP_LAT, PICKUP_LNG),
                    "destination",
                    place(DEST_LAT, DEST_LNG)),
                rider.token()),
            HttpStatus.OK);
    assertThat(estimate.get("pickupFeeRule").get("thresholdKm").decimalValue())
        .isEqualByComparingTo("10.0");
    assertThat(estimate.get("pickupFeeRule").get("perKm").decimalValue())
        .isEqualByComparingTo("0.50");
  }

  @Test
  @DisplayName("UC-A-18: admin ride search and detail need rides:view")
  void shouldGateAdminRides() {
    Account rider = rider();
    UUID rideId = book(rider);
    assertThat(get("/api/v1/admin/rides", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/rides/" + rideId, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    JsonNode page =
        ok(get("/api/v1/admin/rides?state=requested&regionId=" + regionId, admin), HttpStatus.OK);
    assertThat(page.get("totalItems").asLong()).isEqualTo(1);
    assertThat(page.get("items").get(0).get("riderName").asText()).isEqualTo("Rana Rider");
    assertThat(page.get("items").get(0).get("regionName").asText()).isEqualTo("Damascus Rides");
    assertThat(get("/api/v1/admin/rides?state=teleported", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/admin/rides/" + UUID.randomUUID(), admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }
}
