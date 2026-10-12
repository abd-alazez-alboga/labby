package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;

/**
 * Shared fixture of the M8 money integration tests, on top of the ride fixture: wallet grants
 * through the real admin endpoint, wallet/cash bookings, a deterministic completed ride (no metered
 * distance, ~0 duration → the 1.50 minimum fare; default tiers → 25% commission = 0.38) and direct
 * ledger/balance readers.
 */
abstract class AbstractMoneyIntegrationTest extends AbstractRideIntegrationTest {

  /** The deterministic fare of {@link #completeRide}: the service type's minimum. */
  protected static final BigDecimal FARE = new BigDecimal("1.50");

  /** 25% (default base tier) of the 1.50 fare, HALF_UP. */
  protected static final BigDecimal COMMISSION = new BigDecimal("0.38");

  /** Grants wallet credit through the admin endpoint (Super Admin holds wallets:manage). */
  protected void grant(UUID userId, String amount) {
    ok(
        post(
            "/api/v1/admin/users/" + userId + "/wallet/credits",
            Map.of(
                "type", "grant",
                "amount", amount,
                "currency", "SYP",
                "reason", "test grant"),
            admin),
        HttpStatus.CREATED);
  }

  /** The standard booking body with an explicit payment method. */
  protected Map<String, Object> booking(String paymentMethod) {
    Map<String, Object> body = booking(List.of());
    body.put("paymentMethod", paymentMethod);
    return body;
  }

  /** Books with the given method and runs offer → accept → arrive → start → complete. */
  protected UUID completeRide(Account rider, Account driver, String paymentMethod) {
    JsonNode ride = ok(tryBook(rider, booking(paymentMethod)), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(ride.get("id").asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    return UUID.fromString(
        ok(driverAction(driver, rideId, "complete"), HttpStatus.OK).get("id").asText());
  }

  /** Books with the given method and cancels after the grace, recording the region fee (2.00). */
  protected UUID cancelAfterGrace(Account rider, Account driver, String paymentMethod) {
    JsonNode ride = ok(tryBook(rider, booking(paymentMethod)), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(ride.get("id").asText());
    dispatchAndAccept(rideId, driver);
    advance(java.time.Duration.ofMinutes(3)); // region grace is 2 min
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/rides/" + rideId + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    return rideId;
  }

  protected BigDecimal walletBalance(UUID userId) {
    List<BigDecimal> rows =
        jdbcTemplate.queryForList(
            "SELECT balance FROM wallet_balances WHERE user_id = ? AND currency = 'SYP'",
            BigDecimal.class,
            userId);
    return rows.isEmpty() ? BigDecimal.ZERO : rows.get(0);
  }

  protected BigDecimal driverBalance(UUID driverUserId) {
    List<BigDecimal> rows =
        jdbcTemplate.queryForList(
            "SELECT balance FROM driver_balances WHERE driver_user_id = ? AND currency = 'SYP'",
            BigDecimal.class,
            driverUserId);
    return rows.isEmpty() ? BigDecimal.ZERO : rows.get(0);
  }

  /** The driver's ledger rows as {@code type -> amount}, oldest first. */
  protected List<Map<String, Object>> driverLedger(UUID driverUserId) {
    return jdbcTemplate.queryForList(
        "SELECT type, amount, ride_id, rider_due_id, fare_amount, commission_rate,"
            + " commission_amount, balance_after FROM driver_ledger WHERE driver_user_id = ?"
            + " ORDER BY created_at, driver_ledger_id",
        driverUserId);
  }

  protected List<Map<String, Object>> walletTransactions(UUID userId) {
    return jdbcTemplate.queryForList(
        "SELECT type, amount, ride_id, balance_after FROM wallet_transactions WHERE user_id = ?"
            + " ORDER BY created_at, wallet_transaction_id",
        userId);
  }

  /** Asserts both cached balances equal their ledger sums (milestone AC). */
  protected void assertLedgerInvariants() {
    for (Map<String, Object> row :
        jdbcTemplate.queryForList(
            "SELECT b.user_id, b.currency, b.balance, COALESCE(SUM(t.amount), 0) AS ledger FROM"
                + " wallet_balances b LEFT JOIN wallet_transactions t ON t.user_id = b.user_id AND"
                + " t.currency = b.currency GROUP BY b.user_id, b.currency, b.balance")) {
      assertThat((BigDecimal) row.get("balance"))
          .as("wallet %s %s", row.get("user_id"), row.get("currency"))
          .isEqualByComparingTo((BigDecimal) row.get("ledger"));
    }
    for (Map<String, Object> row :
        jdbcTemplate.queryForList(
            "SELECT b.driver_user_id, b.currency, b.balance, COALESCE(SUM(l.amount), 0) AS ledger"
                + " FROM driver_balances b LEFT JOIN driver_ledger l ON l.driver_user_id ="
                + " b.driver_user_id AND l.currency = b.currency GROUP BY b.driver_user_id,"
                + " b.currency, b.balance")) {
      assertThat((BigDecimal) row.get("balance"))
          .as("driver balance %s %s", row.get("driver_user_id"), row.get("currency"))
          .isEqualByComparingTo((BigDecimal) row.get("ledger"));
    }
  }
}
