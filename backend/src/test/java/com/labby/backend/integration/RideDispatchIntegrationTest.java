package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M7-T2 acceptance — sequential dispatch (RIDE-03, RIDE-08, TRK-04) and the offer races: candidate
 * gating (offline, stale stream, wrong service type, busy, nearby-only radius), decline / timeout →
 * next candidate, exhaustion and the 10-minute give-up → {@code no_driver_found} + retry, rider
 * cancel mid-offer, simultaneous accept vs cancel and double accept (exactly one winner), the
 * driver-cancel re-dispatch with the cancelling driver excluded, and the no-show path.
 */
class RideDispatchIntegrationTest extends AbstractRideIntegrationTest {

  @Test
  @DisplayName("RIDE-08: no candidate at all → no_driver_found + push; retry creates a new ride")
  void shouldGiveUpWithoutCandidatesAndRetry() {
    Account rider = rider();
    UUID rideId = book(rider);

    dispatch();
    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");
    JsonNode ride = riderRide(rider, rideId);
    assertThat(ride.get("timeline").get("noDriverFoundAt").isNull()).isFalse();
    assertThat(outboxEvents(rider.userId())).contains("ride.no_driver_found");

    JsonNode retried =
        ok(post("/api/v1/rides/" + rideId + "/retry", null, rider.token()), HttpStatus.CREATED);
    assertThat(retried.get("state").asText()).isEqualTo("requested");
    assertThat(retried.get("retryOfRideId").asText()).isEqualTo(rideId.toString());
    // A second retry while the first is active is refused (one active ride per rider).
    ResponseEntity<JsonNode> again =
        post("/api/v1/rides/" + rideId + "/retry", null, rider.token());
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("active_ride_exists");
    // Retrying a ride that did not end in no_driver_found is a 409.
    UUID retryId = UUID.fromString(retried.get("id").asText());
    assertThat(post("/api/v1/rides/" + retryId + "/retry", null, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("TRK-04 / RIDE-03: offline, stale, busy, suspended, wrong-type: never offered")
  void shouldOfferOnlyEligibleDrivers() {
    UUID comfort =
        jdbcTemplate.queryForObject(
            "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
                + " per_min_rate, minimum_fare) VALUES (?, 'Comfort', 'مريح', 2, 1, 1, 3)"
                + " RETURNING service_type_id",
            UUID.class,
            regionId);
    // Offline: approved but never went online.
    Account offline = approvedDriver("+963937811001", "OFF-1", economy, admin);
    // Wrong service type: online right at the pickup, but only assigned Comfort.
    Account comfortOnly = approvedDriver("+963937811002", "CMF-1", comfort, admin);
    ok(
        put("/api/v1/driver/availability", Map.of("online", true), comfortOnly.token()),
        HttpStatus.OK);
    position(comfortOnly, PICKUP_LAT, PICKUP_LNG);
    // Stale: online at the pickup, then silent for more than 30 s.
    Account stale = driverAt(PICKUP_LAT, PICKUP_LNG);
    advance(Duration.ofSeconds(31));
    // Busy: on another rider's accepted ride.
    Account busy = driverAt(33.5001, 36.30);
    Account otherRider = rider();
    UUID otherRide = book(otherRider);
    dispatchAndAccept(otherRide, busy);
    // Suspended while online (M6 owner item a): the role gate is re-checked at every offer.
    Account suspended = driverAt(33.5002, 36.30);
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended' WHERE user_id = ? AND role = 'driver'",
        suspended.userId());
    // Eligible but farther than all of the above.
    Account eligible = driverAt(33.52, 36.30);

    Account rider = rider();
    UUID rideId = book(rider);
    dispatch();

    assertThat(openOffer(eligible).get("rideId").asText()).isEqualTo(rideId.toString());
    for (Account excluded : List.of(offline, comfortOnly, stale, busy, suspended)) {
      assertThat(hasOpenOffer(excluded)).isFalse();
    }
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM ride_offers WHERE ride_id = ?", Integer.class, rideId))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("UC-R-03: nearby_only skips drivers beyond 10 km; accept_distant_fee reaches them")
  void shouldHonorMatchingToggle() {
    Account farDriver = driverAt(33.61, 36.30); // ~12 km north of the pickup
    Account rider = rider();
    UUID nearbyRide = book(rider);
    dispatch();
    assertThat(stateOf(nearbyRide)).isEqualTo("no_driver_found");

    ok(
        put(
            "/api/v1/rider/preferences",
            Map.of(
                "temperature",
                "cool",
                "conversation",
                "quiet",
                "music",
                "soft",
                "pickupDistanceMode",
                "accept_distant_fee"),
            rider.token()),
        HttpStatus.OK);
    UUID distantRide = book(rider);
    assertThat(riderRide(rider, distantRide).get("pickupDistanceMode").asText())
        .isEqualTo("accept_distant_fee");
    dispatch();
    JsonNode offer = openOffer(farDriver);
    assertThat(offer.get("rideId").asText()).isEqualTo(distantRide.toString());
    // The driver sees the rider's comfort preferences (UC-R-02).
    assertThat(offer.get("rider").get("comfort").get("temperature").asText()).isEqualTo("cool");
    assertThat(offer.get("rider").get("comfort").get("music").asText()).isEqualTo("soft");
  }

  @Test
  @DisplayName("RIDE-03: decline → next candidate; timeout → next; exhaustion → no_driver_found")
  void shouldAdvanceSequentially() {
    Account first = driverAt(33.501, 36.30);
    Account second = driverAt(33.51, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);

    dispatch();
    JsonNode firstOffer = openOffer(first);
    assertThat(hasOpenOffer(second)).isFalse(); // one offer at a time
    ok(
        post(
            "/api/v1/driver/offers/" + firstOffer.get("id").asText() + "/decline",
            null,
            first.token()),
        HttpStatus.NO_CONTENT);
    // Declining twice is a 409; the decline is the driver's only answer.
    assertThat(
            code(
                post(
                    "/api/v1/driver/offers/" + firstOffer.get("id").asText() + "/decline",
                    null,
                    first.token())))
        .isEqualTo("offer_closed");

    dispatch();
    JsonNode secondOffer = openOffer(second);
    assertThat(secondOffer.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(stateOf(rideId)).isEqualTo("offering");

    // 15 s pass without an answer: an expired offer can no longer be accepted ...
    advance(Duration.ofSeconds(16));
    assertThat(code(accept(second, secondOffer.get("id").asText()))).isEqualTo("offer_closed");
    assertThat(hasOpenOffer(second)).isFalse();
    // ... and the next tick times it out; with nobody left the ride ends.
    dispatch();
    assertThat(offerResponses(rideId)).containsExactly("declined", "timeout");
    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");
  }

  @Test
  @DisplayName("RIDE-03: dispatch gives up 10 min after the request even with drivers left")
  void shouldGiveUpAfterTenMinutes() {
    Account first = driverAt(33.501, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);
    dispatch();
    assertThat(openOffer(first).get("rideId").asText()).isEqualTo(rideId.toString());

    advance(Duration.ofMinutes(10));
    Account fresh = driverAt(33.502, 36.30); // eligible and never offered
    dispatch();

    assertThat(stateOf(rideId)).isEqualTo("no_driver_found");
    assertThat(hasOpenOffer(fresh)).isFalse();
    assertThat(offerResponses(rideId)).containsExactly("timeout");
  }

  @Test
  @DisplayName("UC-D-06 E1: a rider cancel withdraws the open offer; accepting it is a 409")
  void shouldWithdrawOfferOnRiderCancel() {
    Account driver = driverAt(33.501, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);
    dispatch();
    String offerId = openOffer(driver).get("id").asText();

    JsonNode cancelled =
        ok(
            post(
                "/api/v1/rides/" + rideId + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("state").asText()).isEqualTo("cancelled_by_rider");
    assertThat(cancelled.get("cancellationFee").isNull()).isTrue(); // before acceptance: free
    assertThat(offerResponses(rideId)).containsExactly("withdrawn");
    assertThat(hasOpenOffer(driver)).isFalse();
    assertThat(code(accept(driver, offerId))).isEqualTo("offer_closed");
  }

  @Test
  @DisplayName("race: accept vs rider cancel at the same instant — never an accept on a dead ride")
  void shouldResolveAcceptVersusCancel() throws Exception {
    for (int round = 0; round < 3; round++) {
      Account driver = driverAt(33.501, 36.30);
      Account rider = rider();
      UUID rideId = book(rider);
      dispatch();
      String offerId = openOffer(driver).get("id").asText();

      List<HttpStatus> statuses =
          simultaneously(
              () -> accept(driver, offerId),
              () ->
                  post(
                      "/api/v1/rides/" + rideId + "/cancel",
                      Map.of("reason", "changed_mind"),
                      rider.token()));

      // The rider may always cancel (before or after acceptance); the ride ends cancelled.
      assertThat(statuses.get(1)).isEqualTo(HttpStatus.OK);
      assertThat(stateOf(rideId)).isEqualTo("cancelled_by_rider");
      if (statuses.get(0) == HttpStatus.OK) {
        // Accept won the lock: the cancel then cancelled an ACCEPTED ride (driver released).
        assertThat(offerResponses(rideId)).containsExactly("accepted");
        assertThat(outboxEvents(driver.userId())).contains("ride.cancelled_by_rider");
      } else {
        // Cancel won: the offer was withdrawn and the accept lost with offer_closed.
        assertThat(statuses.get(0)).isEqualTo(HttpStatus.CONFLICT);
        assertThat(offerResponses(rideId)).containsExactly("withdrawn");
      }
      ok(
          put("/api/v1/driver/availability", Map.of("online", false), driver.token()),
          HttpStatus.OK);
    }
  }

  @Test
  @DisplayName("race: a double accept of the same offer has exactly one winner")
  void shouldAcceptOnlyOnce() throws Exception {
    Account driver = driverAt(33.501, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);
    dispatch();
    String offerId = openOffer(driver).get("id").asText();

    List<HttpStatus> statuses =
        simultaneously(() -> accept(driver, offerId), () -> accept(driver, offerId));

    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    assertThat(outboxEvents(rider.userId()).stream().filter("ride.accepted"::equals)).hasSize(1);
  }

  @Test
  @DisplayName("UC-D-10: driver cancel → new linked ride, rider not charged, canceller excluded")
  void shouldRedispatchAfterDriverCancel() {
    Account canceller = driverAt(33.501, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);
    JsonNode bookedEstimate = riderRide(rider, rideId).get("estimate");
    dispatchAndAccept(rideId, canceller);

    ResponseEntity<JsonNode> noNote =
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "other"),
            canceller.token());
    assertThat(noNote.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    "/api/v1/driver/rides/" + rideId + "/cancel",
                    Map.of("reason", "changed_mind"),
                    canceller.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST); // a rider reason

    JsonNode cancelled =
        ok(
            post(
                "/api/v1/driver/rides/" + rideId + "/cancel",
                Map.of("reason", "vehicle_issue"),
                canceller.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("state").asText()).isEqualTo("cancelled_by_driver");
    assertThat(cancelled.get("cancellationFee").isNull()).isTrue();

    JsonNode oldRide = riderRide(rider, rideId);
    UUID newRideId = UUID.fromString(oldRide.get("redispatchedAsRideId").asText());
    JsonNode newRide = riderRide(rider, newRideId);
    assertThat(newRide.get("state").asText()).isEqualTo("requested");
    assertThat(newRide.get("redispatchOfRideId").asText()).isEqualTo(rideId.toString());
    assertThat(newRide.get("estimate")).isEqualTo(bookedEstimate); // same locked estimate
    assertThat(ok(get("/api/v1/rides/active", rider.token()), HttpStatus.OK).get("id").asText())
        .isEqualTo(newRideId.toString());
    assertThat(outboxEvents(rider.userId())).contains("ride.cancelled_by_driver");

    // The cancelling driver is still the only one around — and is excluded.
    dispatch();
    assertThat(hasOpenOffer(canceller)).isFalse();
    assertThat(stateOf(newRideId)).isEqualTo("no_driver_found");
  }

  @Test
  @DisplayName("UC-D-07 E2: no-show only after the 5-min wait grace; fee recorded, no re-dispatch")
  void shouldCancelForNoShowAfterWaitGrace() {
    Account driver = driverAt(33.501, 36.30);
    Account rider = rider();
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    assertThat(
            code(
                post(
                    "/api/v1/driver/rides/" + rideId + "/cancel",
                    Map.of("reason", "rider_no_show"),
                    driver.token())))
        .isEqualTo("no_show_too_early"); // not even arrived
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    assertThat(
            code(
                post(
                    "/api/v1/driver/rides/" + rideId + "/cancel",
                    Map.of("reason", "rider_no_show"),
                    driver.token())))
        .isEqualTo("no_show_too_early");

    advance(Duration.ofMinutes(5));
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/driver/rides/" + rideId + "/cancel",
                Map.of("reason", "rider_no_show"),
                driver.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(get("/api/v1/rides/active", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(riderRide(rider, rideId).get("redispatchedAsRideId").isNull()).isTrue();
  }
}
