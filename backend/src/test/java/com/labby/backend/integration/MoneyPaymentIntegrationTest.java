package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * PAY-01/02 + COM-01: payment application at completion — fully wallet-paid, mixed (exact split),
 * and cash rides accumulating commission debt — with the ledger postings and cached balances always
 * equal to their ledger sums.
 */
class MoneyPaymentIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName("PAY-02: a covering wallet pays the whole fare — paid_wallet, auto-confirmed")
  void shouldPayFullyFromWallet() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "10.00");

    UUID rideId = completeRide(rider, driver, "wallet");

    JsonNode ride = riderRide(rider, rideId);
    assertThat(ride.get("paymentStatus").asText()).isEqualTo("paid_wallet");
    assertThat(ride.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo(FARE);
    assertThat(ride.get("walletApplied").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(ride.get("cashDue").isNull()).isTrue();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT payment_confirmed_at IS NOT NULL FROM rides WHERE ride_id = ?",
                Boolean.class,
                rideId))
        .isTrue();
    // The wallet: 10.00 − 1.50 = 8.50, one fare_payment debit.
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("8.50");
    List<Map<String, Object>> transactions = walletTransactions(rider.userId());
    assertThat(transactions).hasSize(2); // grant + fare
    assertThat(transactions.get(1).get("type")).isEqualTo("fare_payment");
    assertThat((BigDecimal) transactions.get(1).get("amount")).isEqualByComparingTo("-1.50");
    // COM-01: ride_earning of fare − 25% commission, itemized.
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(1);
    assertThat(ledger.get(0).get("type")).isEqualTo("ride_earning");
    assertThat((BigDecimal) ledger.get(0).get("amount")).isEqualByComparingTo("1.12");
    assertThat((BigDecimal) ledger.get(0).get("fare_amount")).isEqualByComparingTo(FARE);
    assertThat((BigDecimal) ledger.get(0).get("commission_rate")).isEqualByComparingTo("25");
    assertThat((BigDecimal) ledger.get(0).get("commission_amount"))
        .isEqualByComparingTo(COMMISSION);
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("1.12");
    // The receipt shows the split and the cash-confirm endpoint refuses (already settled).
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    assertThat(receipt.get("walletApplied").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(code(driverAction(driver, rideId, "cash-confirm"))).isEqualTo("payment_not_pending");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "PAY-02: a short wallet is drained, the exact remainder is due in cash, cash-confirm"
          + " settles paid_mixed")
  void shouldSplitMixedPaymentExactly() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "0.90");

    UUID rideId = completeRide(rider, driver, "wallet");

    JsonNode ride = riderRide(rider, rideId);
    assertThat(ride.get("paymentStatus").asText()).isEqualTo("pending");
    assertThat(ride.get("walletApplied").decimalValue()).isEqualByComparingTo("0.90");
    assertThat(ride.get("cashDue").decimalValue()).isEqualByComparingTo("0.60");
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("0.00");
    // The fare entry nets the wallet-held part minus the commission: 0.90 − 0.38 = 0.52.
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(1);
    assertThat(ledger.get(0).get("type")).isEqualTo("ride_earning");
    assertThat((BigDecimal) ledger.get(0).get("amount")).isEqualByComparingTo("0.52");
    // The driver confirms the cash remainder → paid_mixed.
    JsonNode settled = ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(settled.get("paymentStatus").asText()).isEqualTo("paid_mixed");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("PAY-02: an empty wallet leaves the whole fare due in cash; mark-unpaid still works")
  void shouldMarkMixedUnpaid() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);

    UUID rideId = completeRide(rider, driver, "wallet");

    JsonNode ride = riderRide(rider, rideId);
    assertThat(ride.get("walletApplied").decimalValue()).isEqualByComparingTo("0.00");
    assertThat(ride.get("cashDue").decimalValue()).isEqualByComparingTo(FARE);
    // Nothing wallet-held: the fare entry degrades to the commission debit.
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(1);
    assertThat(ledger.get(0).get("type")).isEqualTo("commission_due");
    assertThat((BigDecimal) ledger.get(0).get("amount")).isEqualByComparingTo("-0.38");
    JsonNode unpaid =
        ok(
            post(
                "/api/v1/driver/rides/" + rideId + "/mark-unpaid",
                Map.of("note", "rider had no cash"),
                driver.token()),
            HttpStatus.OK);
    assertThat(unpaid.get("paymentStatus").asText()).isEqualTo("unpaid");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("COM-01: cash rides accumulate commission debt on the driver balance")
  void shouldAccumulateCashDebt() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    for (int i = 0; i < 3; i++) {
      Account rider = rider();
      UUID rideId = completeRide(rider, driver, "cash");
      ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
      position(driver, PICKUP_LAT, PICKUP_LNG); // fresh stream for the next dispatch
    }
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(3);
    assertThat(ledger)
        .allSatisfy(
            entry -> {
              assertThat(entry.get("type")).isEqualTo("commission_due");
              assertThat((BigDecimal) entry.get("amount")).isEqualByComparingTo("-0.38");
            });
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("-1.14");
    // UC-D-15: the earnings page itemizes each trip.
    JsonNode earnings = ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK);
    assertThat(earnings.get("totalItems").asLong()).isEqualTo(3);
    JsonNode first = earnings.get("items").get(0);
    assertThat(first.get("fareTotal").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(first.get("paymentMethod").asText()).isEqualTo("cash");
    assertThat(first.get("commissionRate").decimalValue()).isEqualByComparingTo("25");
    assertThat(first.get("commissionAmount").decimalValue()).isEqualByComparingTo(COMMISSION);
    assertThat(first.get("net").decimalValue()).isEqualByComparingTo("-0.38");
    assertLedgerInvariants();
  }
}
