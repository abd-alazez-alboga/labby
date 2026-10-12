package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M8 audit W4: the money writers under real concurrency — two requests released by one latch
 * against the running server. Every race must end in a consistent outcome (both applied, or one
 * cleanly refused), the cached balances equal their ledger sums, and every per-(owner, currency)
 * {@code balance_after} chain is gap-free: each entry's balance_after is the previous one plus its
 * amount.
 */
class MoneyConcurrencyIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName("tip vs completion on an in_progress ride: both apply, in either order")
  void shouldRaceTipAgainstCompletion() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "10.00");
    UUID rideId = startedRide(rider, driver, "wallet");

    List<ResponseEntity<JsonNode>> results =
        race(
            () -> post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", "1.00"), rider.token()),
            () -> driverAction(driver, rideId, "complete"));

    assertThat(results.get(0).getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(results.get(1).getStatusCode()).isEqualTo(HttpStatus.OK);
    // 10.00 − 1.00 tip − 1.50 fare; the driver: tip 1.00 + earning 1.50 − 0.38.
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("7.50");
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("2.12");
    assertThat(riderRide(rider, rideId).get("paymentStatus").asText()).isEqualTo("paid_wallet");
    assertConsistent();
  }

  @Test
  @DisplayName("two simultaneous tips: exactly one applies, the other is 409 already_tipped")
  void shouldRaceTwoTips() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "10.00");
    UUID rideId = completeRide(rider, driver, "wallet");

    List<ResponseEntity<JsonNode>> results =
        race(
            () -> post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", "1.00"), rider.token()),
            () ->
                post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", "2.00"), rider.token()));

    List<HttpStatus> statuses =
        results.stream().map(result -> HttpStatus.valueOf(result.getStatusCode().value())).toList();
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.CREATED, HttpStatus.CONFLICT);
    ResponseEntity<JsonNode> refused =
        results.stream()
            .filter(result -> result.getStatusCode().value() == HttpStatus.CONFLICT.value())
            .findFirst()
            .orElseThrow();
    assertThat(code(refused)).isEqualTo("already_tipped");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM wallet_transactions WHERE ride_id = ? AND type = 'tip'",
                Integer.class,
                rideId))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM driver_ledger WHERE ride_id = ? AND type = 'tip'",
                Integer.class,
                rideId))
        .isEqualTo(1);
    assertConsistent();
  }

  @Test
  @DisplayName("settlement vs a cash completion of the same driver: both post, chain intact")
  void shouldRaceSettlementAgainstCashCompletion() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = startedRide(rider, driver, "cash");

    List<ResponseEntity<JsonNode>> results =
        race(
            () ->
                post(
                    "/api/v1/admin/drivers/" + driver.userId() + "/settlements",
                    Map.of("amount", "1.00", "direction", "pay_in", "currency", "SYP"),
                    admin),
            () -> driverAction(driver, rideId, "complete"));

    assertThat(results.get(0).getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(results.get(1).getStatusCode()).isEqualTo(HttpStatus.OK);
    // +1.00 pay-in − 0.38 commission, whichever landed first.
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("0.62");
    assertThat(driverLedger(driver.userId()))
        .extracting(entry -> entry.get("type"))
        .containsExactlyInAnyOrder("settlement_pay_in", "commission_due");
    assertConsistent();
  }

  /** Books, accepts, arrives and starts — the ride is {@code in_progress}. */
  private UUID startedRide(Account rider, Account driver, String paymentMethod) {
    JsonNode ride = ok(tryBook(rider, booking(paymentMethod)), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(ride.get("id").asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    return rideId;
  }

  /** Runs both calls at the same instant (one latch) and returns their responses in order. */
  @SafeVarargs
  private static List<ResponseEntity<JsonNode>> race(Callable<ResponseEntity<JsonNode>>... calls) {
    ExecutorService executor = Executors.newFixedThreadPool(calls.length);
    CountDownLatch start = new CountDownLatch(1);
    try {
      List<Future<ResponseEntity<JsonNode>>> futures = new ArrayList<>();
      for (Callable<ResponseEntity<JsonNode>> call : calls) {
        futures.add(
            executor.submit(
                () -> {
                  start.await();
                  return call.call();
                }));
      }
      start.countDown();
      List<ResponseEntity<JsonNode>> results = new ArrayList<>();
      for (Future<ResponseEntity<JsonNode>> future : futures) {
        results.add(future.get(30, TimeUnit.SECONDS));
      }
      return results;
    } catch (Exception ex) {
      throw new AssertionError("a racing call failed", ex);
    } finally {
      executor.shutdownNow();
    }
  }

  /** Balance = ledger sum, and every balance_after chain replays from zero without a gap. */
  private void assertConsistent() {
    assertLedgerInvariants();
    assertChains(
        "SELECT driver_user_id AS owner, currency, amount, balance_after FROM driver_ledger",
        "SELECT driver_user_id AS owner, currency, balance FROM driver_balances");
    assertChains(
        "SELECT user_id AS owner, currency, amount, balance_after FROM wallet_transactions",
        "SELECT user_id AS owner, currency, balance FROM wallet_balances");
  }

  /**
   * Replays each (owner, currency) chain from 0: the next entry is the one whose balance_after is
   * the running balance plus its amount (concurrent entries can share a timestamp, so creation
   * order is not used). Every entry must be consumed and the chain must end at the cached balance.
   */
  private void assertChains(String entriesSql, String balancesSql) {
    List<Map<String, Object>> entries = jdbcTemplate.queryForList(entriesSql);
    for (Map<String, Object> balance : jdbcTemplate.queryForList(balancesSql)) {
      List<Map<String, Object>> chain =
          new ArrayList<>(
              entries.stream()
                  .filter(entry -> entry.get("owner").equals(balance.get("owner")))
                  .filter(entry -> entry.get("currency").equals(balance.get("currency")))
                  .toList());
      BigDecimal running = BigDecimal.ZERO;
      while (!chain.isEmpty()) {
        BigDecimal current = running;
        Map<String, Object> next =
            chain.stream()
                .filter(
                    entry ->
                        ((BigDecimal) entry.get("balance_after"))
                                .compareTo(current.add((BigDecimal) entry.get("amount")))
                            == 0)
                .findFirst()
                .orElseThrow(
                    () ->
                        new AssertionError(
                            "balance_after chain broken at %s for %s: %s"
                                .formatted(current, balance, chain)));
        chain.remove(next);
        running = (BigDecimal) next.get("balance_after");
      }
      assertThat(running)
          .as("chain end of %s", balance)
          .isEqualByComparingTo((BigDecimal) balance.get("balance"));
    }
  }
}
