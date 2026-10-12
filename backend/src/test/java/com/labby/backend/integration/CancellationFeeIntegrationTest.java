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
 * RIDE-07 collection (owner rulings 2026-10-11 / 2026-10-12): the fee goes 100% to the cancelled
 * ride's driver, commission-free, credited ONCE when fully collected — wallet-method rides debit
 * the wallet at cancellation; any shortfall (and every cash-method fee) becomes a pending due
 * carried by the rider's NEXT completed ride in the due's currency: from the wallet when it covers
 * it, else in cash — earmarked at completion, collected through the driver's cash-confirm ({@code
 * due_collection}), released by mark-unpaid.
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
    // The wallet covered fare AND due: nothing in cash, the due itemized as a wallet line.
    JsonNode nextView = riderRide(rider, nextRide);
    assertThat(nextView.get("paymentStatus").asText()).isEqualTo("paid_wallet");
    assertThat(nextView.get("cashDue").isNull()).isTrue();
    assertThat(nextView.get("carriedDues")).hasSize(1);
    JsonNode carried = nextView.get("carriedDues").get(0);
    assertThat(carried.get("sourceRideId").asText()).isEqualTo(cancelledId.toString());
    assertThat(carried.get("amount").decimalValue()).isEqualByComparingTo("0.80");
    assertThat(carried.get("currency").asText()).isEqualTo("SYP");
    assertThat(carried.get("method").asText()).isEqualTo("wallet");
    assertThat(carried.get("status").asText()).isEqualTo("collected");
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
      "RIDE-07 + H3: a cash-method fee is carried whole, EARMARKED at the next completion and"
          + " collected on cash-confirm — due_collection debits the collecting driver")
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

    // A DIFFERENT driver completes the next (cash) ride; the due rides along in cash.
    jdbcTemplate.update(
        "UPDATE driver_profiles SET is_online = false WHERE user_id = ?", cancelledDriver.userId());
    Account collectingDriver = driverAt(PICKUP_LAT + 0.001, PICKUP_LNG);
    UUID nextRide = completeRide(rider, collectingDriver, "cash");

    JsonNode ride = riderRide(rider, nextRide);
    assertThat(ride.get("paymentStatus").asText()).isEqualTo("pending");
    // cashDue = the 1.50 fare + the 2.00 carried fee.
    assertThat(ride.get("cashDue").decimalValue()).isEqualByComparingTo("3.50");
    assertCarried(ride, cancelledId, "2.00", "cash", "earmarked");
    // Earmarked only: no money moved yet — the collecting driver has just the fare entry, the
    // cancelled ride's driver nothing.
    assertThat(driverLedger(collectingDriver.userId()))
        .extracting(entry -> entry.get("type"))
        .containsExactly("commission_due");
    assertThat(driverLedger(cancelledDriver.userId())).isEmpty();
    assertThat(dueRow(rider.userId()).get("status")).isEqualTo("pending");
    assertThat(dueRow(rider.userId()).get("collecting_ride_id")).isEqualTo(nextRide);

    // The driver confirms the cash: the due is collected now.
    JsonNode confirmed =
        ok(driverAction(collectingDriver, nextRide, "cash-confirm"), HttpStatus.OK);
    assertThat(confirmed.get("paymentStatus").asText()).isEqualTo("paid_cash");
    assertCarried(confirmed, cancelledId, "2.00", "cash", "collected");
    assertThat(confirmed.get("cashDue").decimalValue()).isEqualByComparingTo("3.50");
    Map<String, Object> due = dueRow(rider.userId());
    assertThat(due.get("status")).isEqualTo("collected");
    assertThat(due.get("collected_ride_id")).isEqualTo(nextRide);
    assertThat(due.get("collecting_ride_id")).isNull();
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
    // A later ride carries nothing more.
    position(collectingDriver, PICKUP_LAT, PICKUP_LNG);
    UUID later = completeRide(rider, collectingDriver, "cash");
    assertThat(riderRide(rider, later).get("carriedDues")).isEmpty();
    assertThat(riderRide(rider, later).get("cashDue").isNull()).isTrue();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM driver_ledger WHERE type = 'due_collection'", Integer.class))
        .isEqualTo(1);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "H3: a wallet that covers the fare but not the due → pending (no paid_wallet); the due is"
          + " earmarked for cash and cash-confirm collects it as paid_mixed")
  void shouldKeepPendingWhenWalletCoversFareButNotDue() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID cancelledId = cancelAfterGrace(rider, driver, "cash"); // 2.00 due
    grant(rider.userId(), "2.50"); // covers the 1.50 fare, not fare + 2.00

    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "wallet");

    JsonNode view = riderRide(rider, rideId);
    assertThat(view.get("paymentStatus").asText()).isEqualTo("pending");
    assertThat(view.get("walletApplied").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(view.get("cashDue").decimalValue()).isEqualByComparingTo("2.00");
    assertCarried(view, cancelledId, "2.00", "cash", "earmarked");
    // The wallet paid the fare only; the due was not taken from it.
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("1.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT payment_confirmed_at IS NULL FROM rides WHERE ride_id = ?",
                Boolean.class,
                rideId))
        .isTrue();
    // The driver view carries the same itemization.
    JsonNode driverView = ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK);
    assertCarried(driverView, cancelledId, "2.00", "cash", "earmarked");
    assertThat(driverView.get("cashDue").decimalValue()).isEqualByComparingTo("2.00");

    JsonNode confirmed = ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(confirmed.get("paymentStatus").asText()).isEqualTo("paid_mixed");
    assertCarried(confirmed, cancelledId, "2.00", "cash", "collected");
    // Same driver both sides: due_collection −2.00 and the cancellation_fee +2.00.
    assertThat(driverLedger(driver.userId()))
        .extracting(entry -> entry.get("type"))
        .containsExactlyInAnyOrder("ride_earning", "due_collection", "cancellation_fee");
    assertThat(dueRow(rider.userId()).get("status")).isEqualTo("collected");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "H3: mark-unpaid releases the earmarked due (no ledger lines); the next ride carries and"
          + " collects it")
  void shouldReleaseDueOnMarkUnpaid() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID cancelledId = cancelAfterGrace(rider, driver, "cash");
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID unpaidRide = completeRide(rider, driver, "cash");
    assertCarried(riderRide(rider, unpaidRide), cancelledId, "2.00", "cash", "earmarked");

    JsonNode unpaid =
        ok(
            post(
                "/api/v1/driver/rides/" + unpaidRide + "/mark-unpaid",
                Map.of("note", "rider refused"),
                driver.token()),
            HttpStatus.OK);
    assertThat(unpaid.get("paymentStatus").asText()).isEqualTo("unpaid");
    // Released: no longer this ride's, pending again, and no money moved for it.
    assertThat(unpaid.get("carriedDues")).isEmpty();
    assertThat(unpaid.get("cashDue").isNull()).isTrue();
    Map<String, Object> released = dueRow(rider.userId());
    assertThat(released.get("status")).isEqualTo("pending");
    assertThat(released.get("collecting_ride_id")).isNull();
    assertThat(driverLedger(driver.userId()))
        .extracting(entry -> entry.get("type"))
        .containsExactly("commission_due");
    assertThat(ok(get("/api/v1/wallet", rider.token()), HttpStatus.OK).get("dues")).hasSize(1);

    // The rider's next ride carries it again; this time the cash arrives.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID nextRide = completeRide(rider, driver, "cash");
    assertCarried(riderRide(rider, nextRide), cancelledId, "2.00", "cash", "earmarked");
    ok(driverAction(driver, nextRide, "cash-confirm"), HttpStatus.OK);
    Map<String, Object> collected = dueRow(rider.userId());
    assertThat(collected.get("status")).isEqualTo("collected");
    assertThat(collected.get("collected_ride_id")).isEqualTo(nextRide);
    assertThat(riderRide(rider, unpaidRide).get("carriedDues")).isEmpty();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT ride_id FROM driver_ledger WHERE type = 'due_collection'", UUID.class))
        .isEqualTo(nextRide);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "H2 (PAY-01 isolation): only dues in the ride's currency are carried — a USD due stays"
          + " pending on a SYP ride")
  void shouldCarryOnlySameCurrencyDues() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID usdSource = cancelAfterGrace(rider, driver, "cash");
    // Stand-in for a fee recorded in a USD region (rider_dues is a workflow row, not a ledger).
    jdbcTemplate.update(
        "UPDATE rider_dues SET currency = 'USD' WHERE source_ride_id = ?", usdSource);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID sypSource = cancelAfterGrace(rider, driver, "cash");

    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    JsonNode view = riderRide(rider, rideId);
    assertCarried(view, sypSource, "2.00", "cash", "earmarked");
    assertThat(view.get("cashDue").decimalValue()).isEqualByComparingTo("3.50"); // 1.50 + 2.00
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);

    Map<String, Object> usdDue =
        jdbcTemplate.queryForMap(
            "SELECT status, collecting_ride_id, collected_ride_id FROM rider_dues"
                + " WHERE source_ride_id = ?",
            usdSource);
    assertThat(usdDue.get("status")).isEqualTo("pending");
    assertThat(usdDue.get("collecting_ride_id")).isNull();
    assertThat(usdDue.get("collected_ride_id")).isNull();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM rider_dues WHERE source_ride_id = ?", String.class, sypSource))
        .isEqualTo("collected");
    // No USD line reached the SYP driver.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM driver_ledger WHERE currency = 'USD'", Integer.class))
        .isZero();
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

  /** Asserts the view carries exactly this one due. */
  private static void assertCarried(
      JsonNode view, UUID sourceRideId, String amount, String method, String status) {
    assertThat(view.get("carriedDues")).hasSize(1);
    JsonNode due = view.get("carriedDues").get(0);
    assertThat(due.get("dueId").asText()).isNotBlank();
    assertThat(due.get("sourceRideId").asText()).isEqualTo(sourceRideId.toString());
    assertThat(due.get("amount").decimalValue()).isEqualByComparingTo(amount);
    assertThat(due.get("currency").asText()).isEqualTo("SYP");
    assertThat(due.get("method").asText()).isEqualTo(method);
    assertThat(due.get("status").asText()).isEqualTo(status);
  }

  /** The rider's single due row. */
  private Map<String, Object> dueRow(UUID riderUserId) {
    return jdbcTemplate.queryForMap(
        "SELECT status, collecting_ride_id, collected_ride_id FROM rider_dues"
            + " WHERE rider_user_id = ?",
        riderUserId);
  }
}
