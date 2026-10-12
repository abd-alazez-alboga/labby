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

/**
 * RIDE-07 collection (owner rulings 2026-10-11): the fee goes 100% to the cancelled ride's driver,
 * commission-free, credited ONCE when fully collected — wallet-method rides debit the wallet at
 * cancellation; any shortfall (and every cash-method fee) becomes a pending due collected on the
 * rider's NEXT completed ride, in cash through the collecting driver ({@code due_collection}).
 */
class CancellationFeeIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName(
      "RIDE-07: a covering wallet pays the fee at cancellation; the driver is credited"
          + " immediately")
  void shouldCollectFeeFromWallet() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");

    UUID rideId = cancelAfterGrace(rider, driver, "wallet");

    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("3.00");
    List<Map<String, Object>> transactions = walletTransactions(rider.userId());
    assertThat(transactions.get(1).get("type")).isEqualTo("cancellation_fee");
    assertThat((BigDecimal) transactions.get(1).get("amount")).isEqualByComparingTo("-2.00");
    assertThat(transactions.get(1).get("ride_id")).isEqualTo(rideId);
    // Fully collected → the driver's commission-free credit, right away.
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(1);
    assertThat(ledger.get(0).get("type")).isEqualTo("cancellation_fee");
    assertThat((BigDecimal) ledger.get(0).get("amount")).isEqualByComparingTo("2.00");
    assertThat(ledger.get(0).get("ride_id")).isEqualTo(rideId);
    // No due was carried.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rider_dues WHERE rider_user_id = ?",
                Integer.class,
                rider.userId()))
        .isZero();
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "RIDE-07: a short wallet is drained and the remainder becomes a pending due — the"
          + " driver is credited only on collection")
  void shouldCarryShortfallAsDue() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "1.20");

    UUID cancelledId = cancelAfterGrace(rider, driver, "wallet");

    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("0.00");
    Map<String, Object> due =
        jdbcTemplate.queryForMap(
            "SELECT amount, status, source_ride_id FROM rider_dues WHERE rider_user_id = ?",
            rider.userId());
    assertThat((BigDecimal) due.get("amount")).isEqualByComparingTo("0.80");
    assertThat(due.get("status")).isEqualTo("pending");
    assertThat(due.get("source_ride_id")).isEqualTo(cancelledId);
    // Not fully collected yet: no driver credit.
    assertThat(driverLedger(driver.userId())).isEmpty();
    // The pending due shows on the rider's wallet view.
    JsonNode wallet = ok(get("/api/v1/wallet", rider.token()), HttpStatus.OK);
    assertThat(wallet.get("dues")).hasSize(1);
    assertThat(wallet.get("dues").get(0).get("amount").decimalValue()).isEqualByComparingTo("0.80");

    // The next completed ride (wallet method, funded) collects the due from the wallet, after the
    // fare — and the CANCELLED ride's driver gets the full 2.00 fee credit.
    grant(rider.userId(), "10.00");
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID nextRide = completeRide(rider, driver, "wallet");

    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("7.70"); // 10 − 1.50 − 0.80
    Map<String, Object> collected =
        jdbcTemplate.queryForMap(
            "SELECT status, collected_ride_id FROM rider_dues WHERE rider_user_id = ?",
            rider.userId());
    assertThat(collected.get("status")).isEqualTo("collected");
    assertThat(collected.get("collected_ride_id")).isEqualTo(nextRide);
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    // ride_earning (next ride) + cancellation_fee credit (cancelled ride), nothing else.
    assertThat(ledger)
        .extracting(entry -> entry.get("type"))
        .containsExactlyInAnyOrder("ride_earning", "cancellation_fee");
    Map<String, Object> feeCredit =
        ledger.stream().filter(e -> e.get("type").equals("cancellation_fee")).findFirst().get();
    assertThat((BigDecimal) feeCredit.get("amount")).isEqualByComparingTo("2.00");
    assertThat(feeCredit.get("ride_id")).isEqualTo(cancelledId);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "RIDE-07: a cash-method fee is carried whole and collected in cash on the next ride"
          + " — due_collection debits the collecting driver")
  void shouldCollectCashDueOnNextCashRide() {
    Account rider = rider();
    Account cancelledDriver = driverAt(PICKUP_LAT, PICKUP_LNG);

    UUID cancelledId = cancelAfterGrace(rider, cancelledDriver, "cash");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM rider_dues WHERE rider_user_id = ?",
                BigDecimal.class,
                rider.userId()))
        .isEqualByComparingTo("2.00");
    assertThat(driverLedger(cancelledDriver.userId())).isEmpty();

    // A DIFFERENT driver completes the next (cash) ride and pockets the due on top of the fare.
    jdbcTemplate.update(
        "UPDATE driver_profiles SET is_online = false WHERE user_id = ?", cancelledDriver.userId());
    Account collectingDriver = driverAt(PICKUP_LAT + 0.001, PICKUP_LNG);
    UUID nextRide = completeRide(rider, collectingDriver, "cash");

    JsonNode ride = riderRide(rider, nextRide);
    // cashDue = the 1.50 fare + the 2.00 carried fee.
    assertThat(ride.get("cashDue").decimalValue()).isEqualByComparingTo("3.50");
    List<Map<String, Object>> collecting = driverLedger(collectingDriver.userId());
    assertThat(collecting)
        .extracting(entry -> entry.get("type"))
        .containsExactlyInAnyOrder("commission_due", "due_collection");
    Map<String, Object> dueCollection =
        collecting.stream().filter(e -> e.get("type").equals("due_collection")).findFirst().get();
    assertThat((BigDecimal) dueCollection.get("amount")).isEqualByComparingTo("-2.00");
    assertThat(dueCollection.get("ride_id")).isEqualTo(nextRide);
    // The cancelled ride's driver got the fee credit exactly once.
    List<Map<String, Object>> cancelledLedger = driverLedger(cancelledDriver.userId());
    assertThat(cancelledLedger).hasSize(1);
    assertThat(cancelledLedger.get(0).get("type")).isEqualTo("cancellation_fee");
    assertThat((BigDecimal) cancelledLedger.get(0).get("amount")).isEqualByComparingTo("2.00");
    assertThat(cancelledLedger.get(0).get("ride_id")).isEqualTo(cancelledId);
    // A later ride collects nothing more.
    position(collectingDriver, PICKUP_LAT, PICKUP_LNG);
    completeRide(rider, collectingDriver, "cash");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM driver_ledger WHERE type = 'due_collection'", Integer.class))
        .isEqualTo(1);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("UC-D-07 E2: a no-show cancellation records and collects the fee the same way")
  void shouldCollectNoShowFee() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");

    JsonNode ride = ok(tryBook(rider, booking("wallet")), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(ride.get("id").asText());
    dispatchAndAccept(rideId, driver);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    advance(Duration.ofMinutes(6)); // past the 5-minute wait grace
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/driver/rides/" + rideId + "/cancel",
                Map.of("reason", "rider_no_show"),
                driver.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");

    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("3.00");
    List<Map<String, Object>> ledger = driverLedger(driver.userId());
    assertThat(ledger).hasSize(1);
    assertThat(ledger.get(0).get("type")).isEqualTo("cancellation_fee");
    assertThat((BigDecimal) ledger.get(0).get("amount")).isEqualByComparingTo("2.00");
    assertLedgerInvariants();
  }
}
