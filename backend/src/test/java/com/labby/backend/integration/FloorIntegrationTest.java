package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * COM-03 / COM-04: the balance floor blocks dispatch at/below the region floor, warns within the
 * margin, and a recorded settlement that lifts the balance unblocks offers — with the driver
 * notified on each crossing (UC-A-27).
 */
class FloorIntegrationTest extends AbstractMoneyIntegrationTest {

  private JsonNode settle(UUID driverUserId, String amount, String direction) {
    return ok(
        post(
            "/api/v1/admin/drivers/" + driverUserId + "/settlements",
            Map.of("amount", amount, "direction", direction, "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
  }

  @Test
  @DisplayName("COM-03: block at the floor stops offers; a settlement lifts and unblocks them")
  void shouldBlockAndUnblockAtTheFloor() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();

    // Drive the balance to the default floor (−50) with a pay-out (any positive amount is legal).
    JsonNode blockedSettlement = settle(driver.userId(), "50.00", "pay_out");
    assertThat(blockedSettlement.get("balance").decimalValue()).isEqualByComparingTo("-50.00");
    assertThat(blockedSettlement.get("floorStatus").asText()).isEqualTo("blocked");

    // The driver sees the blocked state, and availability names the reason.
    JsonNode balance = ok(get("/api/v1/driver/balance", driver.token()), HttpStatus.OK);
    assertThat(balance.get("balances").get(0).get("status").asText()).isEqualTo("blocked");
    assertThat(balance.get("balances").get(0).get("floor").decimalValue())
        .isEqualByComparingTo("-50");
    JsonNode availability = ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK);
    assertThat(availability.get("offersBlockedReason").asText()).isEqualTo("balance_below_floor");

    // Dispatch excludes the blocked driver: the only online driver gets no offer.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID starved = book(rider);
    dispatch();
    assertThat(hasOpenOffer(driver)).isFalse();
    assertThat(stateOf(starved)).isEqualTo("no_driver_found");

    // A pay-in above the floor unblocks: the next dispatch reaches the driver.
    JsonNode lifted = settle(driver.userId(), "45.00", "pay_in");
    assertThat(lifted.get("balance").decimalValue()).isEqualByComparingTo("-5.00");
    assertThat(lifted.get("floorStatus").asText()).isEqualTo("ok");
    UUID rideId = book(rider);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    dispatch();
    JsonNode offer = openOffer(driver);
    assertThat(offer.get("rideId").asText()).isEqualTo(rideId.toString());

    // The crossings notified the driver: blocked at the drop, unblocked at the settlement.
    assertThat(outboxEvents(driver.userId()))
        .contains("driver.balance_blocked", "driver.balance_unblocked");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("COM-03: entering the warning margin above the floor notifies the driver once")
  void shouldWarnInsideTheMargin() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);

    // −45 is within the default 10 margin above the default −50 floor.
    JsonNode warned = settle(driver.userId(), "45.00", "pay_out");
    assertThat(warned.get("floorStatus").asText()).isEqualTo("warning");
    JsonNode balance = ok(get("/api/v1/driver/balance", driver.token()), HttpStatus.OK);
    assertThat(balance.get("balances").get(0).get("status").asText()).isEqualTo("warning");
    assertThat(outboxEvents(driver.userId())).contains("driver.balance_warning");
    assertThat(outboxEvents(driver.userId())).doesNotContain("driver.balance_blocked");

    // Still warned, not blocked: offers flow.
    JsonNode availability = ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK);
    assertThat(availability.get("offersBlockedReason").isNull()).isTrue();
  }

  @Test
  @DisplayName("COM-03: a region floor overrides the default for its currency")
  void shouldUseTheRegionFloor() {
    jdbcTemplate.update(
        "UPDATE regions SET driver_balance_floor = -10 WHERE region_id = ?", regionId);
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);

    JsonNode settled = settle(driver.userId(), "10.00", "pay_out");
    assertThat(settled.get("floorStatus").asText()).isEqualTo("blocked");
    JsonNode balance = ok(get("/api/v1/driver/balance", driver.token()), HttpStatus.OK);
    assertThat(balance.get("balances").get(0).get("floor").decimalValue())
        .isEqualByComparingTo("-10");
  }
}
