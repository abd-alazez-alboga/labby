package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M7-T2 acceptance — the ride lifecycle end to end over the real API (rides-v1.yaml): booking →
 * dispatch → accept → geofenced arrive → start → traced ride → metered fare (known trace fixture) →
 * cash → receipt / history / admin detail; the minimum-fare floor; the surcharge locked at request;
 * stored components never recomputed; the offline block during a ride; in-ride route changes; the
 * stream-lost monitor.
 */
class RideLifecycleIntegrationTest extends AbstractRideIntegrationTest {

  private JsonNode fare(Account rider, UUID rideId) {
    return riderRide(rider, rideId).get("fare");
  }

  @Test
  @DisplayName("happy path: book → offer → accept → arrive (geofence) → start → complete → cash")
  void shouldRunTheWholeRide() {
    Account rider = rider();
    Account near = driverAt(33.505, 36.30); // ~550 m north of the pickup
    Account far = driverAt(33.55, 36.30); // ~5.5 km north
    UUID rideId = book(rider);

    JsonNode booked = riderRide(rider, rideId);
    assertThat(booked.get("estimate").get("approximate").asBoolean()).isTrue(); // OSRM down
    assertThat(booked.get("surgeMultiplier").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(booked.get("surchargePercent").decimalValue()).isEqualByComparingTo("0");
    assertThat(booked.get("driver").isNull()).isTrue();
    assertThat(booked.get("pickupDistanceMode").asText()).isEqualTo("nearby_only");

    // Dispatch: the nearest driver by pickup ETA gets the one open offer.
    assertThat(dispatch()).isEqualTo(1);
    assertThat(stateOf(rideId)).isEqualTo("offering");
    assertThat(hasOpenOffer(far)).isFalse();
    JsonNode offer = openOffer(near);
    assertThat(offer.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(offer.get("destination").get("lat").asDouble()).isEqualTo(DEST_LAT);
    assertThat(offer.get("pickupDistanceMeters").asLong()).isBetween(500L, 1000L);
    assertThat(offer.get("estimatedFare").decimalValue())
        .isEqualByComparingTo(booked.get("estimate").get("components").get("total").decimalValue());
    assertThat(offer.get("surge").asBoolean()).isFalse();
    assertThat(offer.get("rider").get("firstName").asText()).isEqualTo("Rana");
    assertThat(offer.get("rider").get("rating").isNull()).isTrue();
    assertThat(offer.get("rider").get("comfort").get("music").asText()).isEqualTo("no_preference");
    assertThat(
            Duration.between(
                Instant.parse(offer.get("offeredAt").asText()),
                Instant.parse(offer.get("expiresAt").asText())))
        .isEqualTo(Duration.ofSeconds(15));

    // Accept: driver + vehicle bound, grace clock started, rider sees the driver card.
    JsonNode accepted = ok(accept(near, offer.get("id").asText()), HttpStatus.OK);
    assertThat(accepted.get("state").asText()).isEqualTo("accepted");
    assertThat(accepted.get("rider").get("firstName").asText()).isEqualTo("Rana");
    JsonNode riderView = riderRide(rider, rideId);
    assertThat(riderView.get("driver").get("firstName").asText()).isEqualTo("Driver");
    assertThat(riderView.get("driver").get("vehicle").get("plate").asText()).startsWith("RD-");
    assertThat(riderView.get("driver").get("photoUrl").asText()).startsWith("/api/v1/files/");
    assertThat(riderView.get("driverStream").asText()).isEqualTo("ok");
    assertThat(riderView.get("driverPosition").get("lat").asDouble()).isEqualTo(33.505);
    Instant acceptedAt = Instant.parse(riderView.get("timeline").get("acceptedAt").asText());
    assertThat(Instant.parse(riderView.get("cancellationGraceEndsAt").asText()))
        .isEqualTo(acceptedAt.plus(Duration.ofMinutes(2)));

    // Arrive is geofenced (UC-D-07 E1): 550 m away → 422 with the distance hint.
    ResponseEntity<JsonNode> tooFar = driverAction(near, rideId, "arrive");
    assertThat(tooFar.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(tooFar)).isEqualTo("outside_geofence");
    assertThat(tooFar.getBody().get("details").get("distanceMeters").asLong())
        .isBetween(500L, 600L);
    assertThat(tooFar.getBody().get("details").get("geofenceMeters").asInt()).isEqualTo(100);
    assertThat(stateOf(rideId)).isEqualTo("accepted");

    position(near, 33.5005, 36.30); // ~55 m: inside the geofence
    JsonNode arrived = ok(driverAction(near, rideId, "arrive"), HttpStatus.OK);
    assertThat(arrived.get("state").asText()).isEqualTo("driver_arrived");
    Instant arrivedAt = Instant.parse(arrived.get("timeline").get("driverArrivedAt").asText());
    assertThat(Instant.parse(arrived.get("waitGraceEndsAt").asText()))
        .isEqualTo(arrivedAt.plus(Duration.ofMinutes(5)));
    // Start is only legal from driver_arrived; complete is not legal yet.
    assertThat(driverAction(near, rideId, "complete").getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    JsonNode started = ok(driverAction(near, rideId, "start"), HttpStatus.OK);
    Instant startedAt = Instant.parse(started.get("timeline").get("startedAt").asText());

    // The known trace fixture, as one reconnect batch: 1109.135 m north + 929.119 m east.
    advance(Duration.ofSeconds(3));
    Instant now = CLOCK.instant();
    ok(
        post(
            "/api/v1/driver/locations",
            Map.of(
                "samples",
                List.of(
                    sample(33.50, 36.30, now.minusSeconds(2)),
                    sample(33.51, 36.30, now.minusSeconds(1)),
                    sample(33.51, 36.31, now))),
            near.token()),
        HttpStatus.ACCEPTED);

    // Complete exactly 10 minutes after start: the metered fare is computed and stored.
    CLOCK.set(startedAt.plus(Duration.ofMinutes(10)));
    JsonNode completed = ok(driverAction(near, rideId, "complete"), HttpStatus.OK);
    assertThat(completed.get("state").asText()).isEqualTo("completed");
    assertThat(completed.get("paymentStatus").asText()).isEqualTo("pending");
    JsonNode fare = completed.get("fare");
    assertThat(fare.get("distanceMeters").asLong()).isCloseTo(2038L, within(1L));
    assertThat(fare.get("durationSeconds").asLong()).isEqualTo(600L);
    JsonNode components = fare.get("components");
    assertThat(components.get("baseFare").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(components.get("distanceFare").decimalValue()).isEqualByComparingTo("1.02");
    assertThat(components.get("timeFare").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(components.get("minimumFareAdjustment").decimalValue()).isEqualByComparingTo("0");
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo("3.02");
    // Only in-ride samples are metered; the to-pickup leg is traced but not charged.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM ride_traces WHERE ride_id = ? AND phase = 'to_pickup'",
                Integer.class,
                rideId))
        .isPositive();

    // Both parties see the same stored fare; the receipt renders from it.
    assertThat(fare(rider, rideId)).isEqualTo(fare);
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    assertThat(receipt.get("fare")).isEqualTo(fare);
    assertThat(receipt.get("route").get("coordinates")).hasSize(3);
    assertThat(receipt.get("driver").get("firstName").asText()).isEqualTo("Driver");

    // Cash: confirmed once; the second confirm is a 409.
    JsonNode paid = ok(driverAction(near, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(paid.get("paymentStatus").asText()).isEqualTo("paid_cash");
    assertThat(code(driverAction(near, rideId, "cash-confirm"))).isEqualTo("payment_not_pending");
    assertThat(get("/api/v1/driver/rides/active", near.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(get("/api/v1/rides/active", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    // History on both sides.
    JsonNode history = ok(get("/api/v1/rides", rider.token()), HttpStatus.OK);
    assertThat(history.get("totalItems").asLong()).isEqualTo(1);
    assertThat(history.get("items").get(0).get("total").decimalValue())
        .isEqualByComparingTo("3.02");
    assertThat(
            ok(get("/api/v1/driver/rides", near.token()), HttpStatus.OK)
                .get("items")
                .get(0)
                .get("id")
                .asText())
        .isEqualTo(rideId.toString());

    // Pushes: every transition reached the party that did not cause it (category ride).
    assertThat(outboxEvents(rider.userId()))
        .containsSubsequence(
            "ride.accepted", "ride.driver_arrived", "ride.started", "ride.completed");
    assertThat(outboxEvents(near.userId())).contains("ride.offer");
    assertThat(outboxEvents(far.userId())).doesNotContain("ride.offer");

    // Admin: the full truth (UC-A-18).
    JsonNode detail = ok(get("/api/v1/admin/rides/" + rideId, admin), HttpStatus.OK);
    assertThat(detail.get("riderPhone").asText()).isEqualTo(rider.phone());
    assertThat(detail.get("driverPhone").asText()).isEqualTo(near.phone());
    // Contact access (UC-A-20): rides:view alone sees the ride but never the party phones.
    UUID ridesViewerRole =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('Rides viewer', false) RETURNING role_id",
            UUID.class);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = 'rides:view'",
        ridesViewerRole);
    String ridesViewer = registerAdmin("+963937904001", ridesViewerRole);
    JsonNode withheld = ok(get("/api/v1/admin/rides/" + rideId, ridesViewer), HttpStatus.OK);
    assertThat(withheld.get("riderPhone").isNull()).isTrue();
    assertThat(withheld.get("driverPhone").isNull()).isTrue();
    assertThat(withheld.get("riderName").asText()).isEqualTo(detail.get("riderName").asText());
    assertThat(detail.get("driverUserId").asText()).isEqualTo(near.userId().toString());
    assertThat(detail.get("offers")).hasSize(1);
    assertThat(detail.get("offers").get(0).get("response").asText()).isEqualTo("accepted");
    assertThat(detail.get("trace").size()).isGreaterThanOrEqualTo(4);
    assertThat(detail.get("ride").get("fare")).isEqualTo(fare);
    JsonNode timeline = detail.get("ride").get("timeline");
    for (String reached :
        List.of("requestedAt", "offeringAt", "acceptedAt", "driverArrivedAt", "startedAt")) {
      assertThat(timeline.get(reached).isNull()).as(reached).isFalse();
    }
    assertThat(timeline.get("cancelledAt").isNull()).isTrue();
    JsonNode search =
        ok(
            get("/api/v1/admin/rides?state=completed&userId=" + near.userId(), admin),
            HttpStatus.OK);
    assertThat(search.get("totalItems").asLong()).isEqualTo(1);
    assertThat(search.get("items").get(0).get("total").decimalValue()).isEqualByComparingTo("3.02");
  }

  @Test
  @DisplayName("PRC-01: a trip below the minimum is floored with a top-up component")
  void shouldFloorAtMinimumFare() {
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);

    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    JsonNode components = completed.get("fare").get("components");
    assertThat(completed.get("fare").get("distanceMeters").asLong()).isZero();
    assertThat(components.get("minimumFareAdjustment").decimalValue()).isPositive();
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo("1.50");
  }

  @Test
  @DisplayName("the surcharge % is locked at request: the fare keeps it after the window ends")
  void shouldLockSurchargeAtRequest() {
    // start = end: the window covers every day, all day (owner rule 2026-10-07).
    jdbcTemplate.update(
        "INSERT INTO surcharge_windows (region_id, label, starts_at, ends_at, days_of_week,"
            + " percent) VALUES (?, 'All day', '00:00', '00:00', '[1,2,3,4,5,6,7]', 25)",
        regionId);
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    JsonNode booked = riderRide(rider, rideId);
    assertThat(booked.get("surchargePercent").decimalValue()).isEqualByComparingTo("25");
    assertThat(booked.get("estimate").get("components").get("surchargeAmount").decimalValue())
        .isPositive();

    jdbcTemplate.update("DELETE FROM surcharge_windows WHERE region_id = ?", regionId);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    advance(Duration.ofMinutes(10));
    JsonNode components =
        ok(driverAction(driver, rideId, "complete"), HttpStatus.OK).get("fare").get("components");
    assertThat(components.get("surchargePercent").decimalValue()).isEqualByComparingTo("25");
    // 10 min: subtotal 1.00 + 0 + 1.00 = 2.00 → +25% = 0.50 → 2.50.
    assertThat(components.get("surchargeAmount").decimalValue()).isEqualByComparingTo("0.50");
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo("2.50");
  }

  @Test
  @DisplayName("PRC-04: the receipt shows the stored fare even if pricing changes afterwards")
  void shouldNeverRecomputeStoredFare() {
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    advance(Duration.ofMinutes(10));
    JsonNode fare = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK).get("fare");

    jdbcTemplate.update(
        "UPDATE service_types SET base_fare = 9.00, per_min_rate = 5.00 WHERE service_type_id = ?",
        economy);
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    assertThat(receipt.get("fare")).isEqualTo(fare);
    assertThat(fare.get("components").get("baseFare").decimalValue()).isEqualByComparingTo("1.00");
  }

  @Test
  @DisplayName("UC-D-04 / M7: no going offline during a ride; allowed again after it ends")
  void shouldBlockOfflineDuringRide() {
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);

    assertThat(
            put("/api/v1/driver/availability", Map.of("online", false), driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "mark-unpaid"), HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT payment_status FROM rides WHERE ride_id = ?", String.class, rideId))
        .isEqualTo("unpaid");
    ok(put("/api/v1/driver/availability", Map.of("online", false), driver.token()), HttpStatus.OK);
  }

  @Test
  @DisplayName("RIDE-05: the rider changes destination / stops in-ride; estimate moves, locks stay")
  void shouldChangeRouteInRide() {
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    assertThat(
            put(
                    "/api/v1/rides/" + rideId + "/route",
                    Map.of("destination", place(33.55, 36.35)),
                    rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT); // not yet accepted
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode before = riderRide(rider, rideId);

    JsonNode changed =
        ok(
            put(
                "/api/v1/rides/" + rideId + "/route",
                Map.of("destination", place(33.55, 36.35), "stops", List.of(place(33.52, 36.32))),
                rider.token()),
            HttpStatus.OK);
    assertThat(changed.get("destination").get("lat").asDouble()).isEqualTo(33.55);
    assertThat(changed.get("stops")).hasSize(1);
    assertThat(changed.get("estimate").get("distanceMeters").asLong())
        .isGreaterThan(before.get("estimate").get("distanceMeters").asLong());
    assertThat(changed.get("surchargePercent").decimalValue())
        .isEqualByComparingTo(before.get("surchargePercent").decimalValue());
    // The driver sees the new destination too.
    assertThat(
            ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK)
                .get("destination")
                .get("lat")
                .asDouble())
        .isEqualTo(33.55);

    ResponseEntity<JsonNode> tooMany =
        put(
            "/api/v1/rides/" + rideId + "/route",
            Map.of(
                "destination",
                place(33.55, 36.35),
                "stops",
                List.of(
                    place(33.52, 36.32),
                    place(33.53, 36.32),
                    place(33.54, 36.32),
                    place(33.54, 36.33))),
            rider.token());
    assertThat(tooMany.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(tooMany)).isEqualTo("too_many_stops");
    ResponseEntity<JsonNode> outside =
        put(
            "/api/v1/rides/" + rideId + "/route",
            Map.of("destination", place(34.50, 36.30)),
            rider.token());
    assertThat(code(outside)).isEqualTo("outside_region");
  }

  @Test
  @DisplayName("TRK-04: the monitor flags a silent driver stream once and clears it on resume")
  void shouldFlagLostDriverStream() {
    Account rider = rider();
    Account driver = driverAt(33.5003, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);

    rideTrackingService.monitor();
    assertThat(riderRide(rider, rideId).get("driverStream").asText()).isEqualTo("ok");
    assertThat(riderRide(rider, rideId).get("etaSeconds").isNull()).isFalse();

    advance(Duration.ofSeconds(31));
    assertThat(rideTrackingService.monitor()).isEqualTo(1);
    assertThat(riderRide(rider, rideId).get("driverStream").asText()).isEqualTo("lost");
    assertThat(
            ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK)
                .get("driverStream")
                .asText())
        .isEqualTo("lost");

    position(driver, 33.5002, 36.30);
    rideTrackingService.monitor();
    assertThat(riderRide(rider, rideId).get("driverStream").asText()).isEqualTo("ok");
  }
}
