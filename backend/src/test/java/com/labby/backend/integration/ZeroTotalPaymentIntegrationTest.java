package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * V1 audit C2 + W29 (money-v1 "Zero total"): a promo covering the whole fare leaves nothing to
 * collect — the wallet writes nothing (the ledger forbids zero-amount rows) and the payment settles
 * at completion, so the ride is never stuck and the driver is never asked to collect 0.
 */
class ZeroTotalPaymentIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName("C2: a wallet ride with a positive balance and a full-fare promo completes paid")
  void shouldCompleteFullyDiscountedWalletRide() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "5.00");
    regionPromo("WALLFREE");

    Map<String, Object> body = booking("wallet");
    body.put("promoCode", "WALLFREE");
    UUID rideId = UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    assertThat(completed.get("paymentStatus").asText()).isEqualTo("paid_wallet");
    assertThat(completed.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo("0.00");
    assertThat(paymentConfirmedAt(rideId)).isNotNull();
    // Nothing was debited: no fare_payment row, the balance is untouched.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM wallet_transactions WHERE ride_id = ? AND type ="
                    + " 'fare_payment'",
                Integer.class,
                rideId))
        .isZero();
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("5.00");
    // Settled: the driver has nothing left to confirm.
    assertThat(code(driverAction(driver, rideId, "cash-confirm"))).isEqualTo("payment_not_pending");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("W29: a cash ride with a full-fare promo settles at completion (paid_cash)")
  void shouldSettleZeroTotalCashRideAtCompletion() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    regionPromo("CASHFREE");

    Map<String, Object> body = booking("cash");
    body.put("promoCode", "CASHFREE");
    UUID rideId = UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    assertThat(completed.get("paymentStatus").asText()).isEqualTo("paid_cash");
    assertThat(completed.get("cashDue").isNull()).isTrue();
    assertThat(paymentConfirmedAt(rideId)).isNotNull();
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("W29: a zero total that carries a cash due stays pending for the driver")
  void shouldKeepZeroTotalWithCashDuePending() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    cancelAfterGrace(rider, driver, "cash"); // a 2.00 due, carried in cash
    regionPromo("DUEFREE");

    Map<String, Object> body = booking("cash");
    body.put("promoCode", "DUEFREE");
    UUID rideId = UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
    position(driver, PICKUP_LAT, PICKUP_LNG); // fresh fix after the grace wait
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    assertThat(completed.get("paymentStatus").asText()).isEqualTo("pending");
    assertThat(completed.get("cashDue").decimalValue()).isEqualByComparingTo("2.00");
  }

  @Test
  @DisplayName("C2: a shared member's full-share promo on a wallet share completes paid_wallet")
  void shouldCompleteFullyDiscountedWalletShare() {
    Account creator = rider();
    Account joiner = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(joiner.userId(), "5.00");
    regionPromo("SHAREFREE");

    Map<String, Object> create = new LinkedHashMap<>();
    create.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    create.put("destination", place(DEST_LAT, DEST_LNG));
    create.put("serviceTypeId", economy.toString());
    create.put("paymentMethod", "cash");
    create.put("totalSeats", 2);
    create.put("partySize", 1);
    create.put(
        "departure",
        Map.of(
            "mode", "at_time", "departAt", CLOCK.instant().plus(Duration.ofHours(1)).toString()));
    UUID rideId =
        UUID.fromString(
            ok(post("/api/v1/shared-rides", create, creator.token()), HttpStatus.CREATED)
                .get("rideId")
                .asText());
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "wallet", "promoCode", "SHAREFREE"),
            joiner.token()),
        HttpStatus.OK);

    dispatch();
    ok(accept(driver, openOffer(driver).get("id").asText()), HttpStatus.OK);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    Map<String, Object> joinerRow =
        jdbcTemplate.queryForMap(
            "SELECT share_amount, payment_status, payment_confirmed_at FROM shared_ride_members"
                + " WHERE ride_id = ? AND rider_user_id = ?",
            rideId,
            joiner.userId());
    assertThat((BigDecimal) joinerRow.get("share_amount")).isEqualByComparingTo("0.00");
    assertThat(joinerRow.get("payment_status")).isEqualTo("paid_wallet");
    assertThat(joinerRow.get("payment_confirmed_at")).isNotNull();
    assertThat(walletBalance(joiner.userId())).isEqualByComparingTo("5.00");
    // The cash-paying creator is still due.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT payment_status FROM shared_ride_members WHERE ride_id = ? AND"
                    + " rider_user_id = ?",
                String.class,
                rideId,
                creator.userId()))
        .isEqualTo("pending");
    assertLedgerInvariants();
  }

  /** A fixed 5.00 promo bound to the test region (larger than any test fare or share). */
  private void regionPromo(String code) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", code);
    body.put("type", "fixed");
    body.put("value", "5.00");
    body.put("regionId", regionId.toString());
    body.put("startsAt", CLOCK.instant().minus(Duration.ofHours(1)).toString());
    body.put("endsAt", CLOCK.instant().plus(Duration.ofDays(30)).toString());
    ok(post("/api/v1/admin/promos", body, admin), HttpStatus.CREATED);
  }

  private Instant paymentConfirmedAt(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_confirmed_at FROM rides WHERE ride_id = ?", Instant.class, rideId);
  }
}
