package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * PAY-04 / UC-R-08: wallet-only tips, in-ride until 24 h after completion, once per ride, 100% to
 * the driver commission-free — each refusal with its own 409.
 */
class TipIntegrationTest extends AbstractMoneyIntegrationTest {

  private ResponseEntity<JsonNode> tip(Account rider, UUID rideId, String amount) {
    return post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", amount), rider.token());
  }

  @Test
  @DisplayName("PAY-04: a tip after completion debits the wallet and credits the driver in full")
  void shouldTipAfterCompletion() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");
    UUID rideId = completeRide(rider, driver, "cash");

    advance(Duration.ofHours(23));
    JsonNode applied = ok(tip(rider, rideId, "2.00"), HttpStatus.CREATED);
    assertThat(applied.get("amount").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(applied.get("currency").asText()).isEqualTo("SYP");
    assertThat(applied.get("walletBalance").decimalValue()).isEqualByComparingTo("3.00");

    // 100% to the driver, commission-free, outside the fare total.
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(2); // commission_due + tip
    assertThat(ledger.get(1).get("type")).isEqualTo("tip");
    assertThat((BigDecimal) ledger.get(1).get("amount")).isEqualByComparingTo("2.00");
    JsonNode ride = riderRide(rider, rideId);
    assertThat(ride.get("tip").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(ride.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo(FARE);
    // One tip per ride (owner ruling).
    ResponseEntity<JsonNode> second = tip(rider, rideId, "1.00");
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(second)).isEqualTo("already_tipped");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("PAY-04: tipping is allowed during the ride (in_progress)")
  void shouldTipDuringRide() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);

    ok(tip(rider, rideId, "1.25"), HttpStatus.CREATED);
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("3.75");
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("PAY-04: the window closes 24 h after completion (clock-controlled)")
  void shouldRefuseExpiredWindow() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");
    UUID rideId = completeRide(rider, driver, "cash");

    advance(Duration.ofHours(24).plusSeconds(1));
    ResponseEntity<JsonNode> late = tip(rider, rideId, "1.00");
    assertThat(late.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(late)).isEqualTo("tip_window_closed");
  }

  @Test
  @DisplayName("PAY-04: refusals — insufficient balance, wrong state, foreign ride, bad amount")
  void shouldRefuseInvalidTips() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "0.50");
    UUID rideId = completeRide(rider, driver, "cash");

    ResponseEntity<JsonNode> poor = tip(rider, rideId, "2.00");
    assertThat(poor.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(poor)).isEqualTo("insufficient_balance");

    // A cancelled ride is not tippable.
    Account rider2 = rider();
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID cancelled = cancelAfterGrace(rider2, driver, "cash");
    ResponseEntity<JsonNode> notTippable = tip(rider2, cancelled, "1.00");
    assertThat(notTippable.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(notTippable)).isEqualTo("not_tippable");

    // Another rider's ride is a plain 404; a non-positive amount is a 400.
    assertThat(tip(rider2, rideId, "1.00").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(tip(rider, rideId, "0").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
  }
}
