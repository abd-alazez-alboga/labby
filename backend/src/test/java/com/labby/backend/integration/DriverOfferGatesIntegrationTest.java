package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * V1 audit W26 (rides-v1 "a suspended driver is never offered"): accept requires the driver role
 * ACTIVE and the driver online, and going offline — voluntarily or forced by a suspension —
 * withdraws the driver's open offer so dispatch moves on to the next driver.
 */
class DriverOfferGatesIntegrationTest extends AbstractRideIntegrationTest {

  @Test
  @DisplayName("W26: going offline withdraws the open offer; accept is closed; dispatch moves on")
  void shouldWithdrawOfferWhenDriverGoesOffline() {
    Account rider = rider();
    Account first = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatch();
    JsonNode offer = openOffer(first);
    assertThat(offer.get("rideId").asText()).isEqualTo(rideId.toString());

    ok(put("/api/v1/driver/availability", Map.of("online", false), first.token()), HttpStatus.OK);
    assertThat(offerResponses(rideId)).containsExactly("withdrawn");
    ResponseEntity<JsonNode> late = accept(first, offer.get("id").asText());
    assertThat(late.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(late)).isEqualTo("offer_closed");

    // The next dispatch step offers the ride to another driver.
    Account second = driverAt(PICKUP_LAT, PICKUP_LNG);
    dispatch();
    assertThat(openOffer(second).get("rideId").asText()).isEqualTo(rideId.toString());
  }

  @Test
  @DisplayName("W26: a driver role suspended inside the offer window cannot accept")
  void shouldRefuseAcceptAfterRoleSuspension() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatch();
    String offerId = openOffer(driver).get("id").asText();

    assertThat(
            post(
                    "/api/v1/admin/users/" + driver.userId() + "/roles/driver/suspend",
                    Map.of("note", "Under review"),
                    admin)
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();
    // The forced offline withdrew the offer.
    assertThat(offerResponses(rideId)).containsExactly("withdrawn");
    ResponseEntity<JsonNode> refused = accept(driver, offerId);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(refused)).isEqualTo("offer_closed");
  }

  @Test
  @DisplayName("W26: an offline driver whose offer is still open cannot accept it")
  void shouldRefuseAcceptWhileOffline() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatch();
    String offerId = openOffer(driver).get("id").asText();
    // Offline without going through the availability endpoint (e.g. a stale replica write).
    jdbcTemplate.update(
        "UPDATE driver_profiles SET is_online = false WHERE user_id = ?", driver.userId());
    assertThat(code(accept(driver, offerId))).isEqualTo("offer_closed");
    assertThat(stateOf(rideId)).isEqualTo("offering");
  }
}
