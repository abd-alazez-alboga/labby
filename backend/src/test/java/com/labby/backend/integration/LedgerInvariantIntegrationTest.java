package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.SettlementRequestDto;
import com.labby.backend.enums.DriverLedgerType;
import com.labby.backend.enums.SettlementDirection;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.service.AdminMoneyService;
import com.labby.backend.service.DriverLedgerService;
import com.labby.backend.service.DriverLedgerService.LedgerPosting;
import com.labby.backend.service.WalletService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The M8 milestone AC, property-style: after ANY random sequence of money operations through the
 * real services (credits, partial and strict debits, settlements in both directions, bonus postings
 * — each its own transaction, like production requests), every cached balance equals its ledger sum
 * and no wallet is negative.
 */
class LedgerInvariantIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final int OPERATIONS = 150;
  private static final String[] CURRENCIES = {"SYP", "USD"};

  @Autowired private WalletService walletService;
  @Autowired private DriverLedgerService driverLedgerService;
  @Autowired private AdminMoneyService adminMoneyService;

  @Test
  @DisplayName("balances always equal their ledger sums, whatever the operation order")
  void shouldHoldLedgerInvariantsUnderRandomOperations() {
    long seed = System.nanoTime();
    Random random = new Random(seed);
    Account riderA = registerWithoutPhoto("+963937816001", "Prop A");
    Account riderB = registerWithoutPhoto("+963937816002", "Prop B");
    Account driver = registerWithoutPhoto("+963937816003", "Prop Driver");
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'driver', 'active')",
        driver.userId());
    List<UUID> riders = List.of(riderA.userId(), riderB.userId());
    List<UUID> ridePool = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
      ridePool.add(insertCancelledRide(riders.get(i % 2)));
    }

    int conflicts = 0;
    for (int i = 0; i < OPERATIONS; i++) {
      UUID rider = riders.get(random.nextInt(riders.size()));
      String currency = CURRENCIES[random.nextInt(CURRENCIES.length)];
      BigDecimal amount =
          BigDecimal.valueOf(random.nextInt(1, 2000), 2).setScale(2, RoundingMode.HALF_UP);
      UUID ride = ridePool.get(random.nextInt(ridePool.size()));
      switch (random.nextInt(6)) {
        case 0 ->
            walletService.credit(
                rider,
                currency,
                amount,
                WalletTransactionType.ADMIN_GRANT,
                null,
                driver.userId(),
                "property op " + i);
        case 1 ->
            walletService.debitUpTo(
                rider, currency, amount, WalletTransactionType.FARE_PAYMENT, ride);
        case 2 -> {
          try {
            walletService.debit(
                rider, currency, amount, WalletTransactionType.CANCELLATION_FEE, ride);
          } catch (ConflictException expected) {
            conflicts++; // insufficient balance: a legal outcome, nothing may have moved
          }
        }
        case 3 ->
            adminMoneyService.settle(
                riderA.userId(),
                driver.userId(),
                new SettlementRequestDto(amount, SettlementDirection.PAY_IN, currency, null));
        case 4 ->
            adminMoneyService.settle(
                riderA.userId(),
                driver.userId(),
                new SettlementRequestDto(amount, SettlementDirection.PAY_OUT, currency, null));
        default ->
            driverLedgerService.post(
                LedgerPosting.forRide(
                    driver.userId(), currency, amount, DriverLedgerType.BONUS, null, null));
      }
    }

    assertThat(conflicts).as("seed %s", seed).isLessThan(OPERATIONS);
    for (UUID rider : riders) {
      for (String currency : CURRENCIES) {
        assertThat(walletService.balance(rider, currency))
            .as("wallet %s %s (seed %s)", rider, currency, seed)
            .isGreaterThanOrEqualTo(BigDecimal.ZERO);
      }
    }
    // The cached balances equal their ledger sums — for every wallet and driver row (seeded run).
    assertLedgerInvariants();
  }

  /** A terminal ride row the wallet debits may link to (minimal, per the V10 CHECKs). */
  private UUID insertCancelledRide(UUID riderUserId) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, state, pickup,"
            + " destination, payment_method, pickup_distance_mode, currency, estimate_total,"
            + " estimate_distance_m, estimate_duration_s, estimate_components, requested_at,"
            + " cancelled_at, cancellation_reason) VALUES (?, ?, ?, ?, 'cancelled_by_rider',"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.31, 33.51), 4326), 'cash', 'nearby_only', 'SYP', 1.50,"
            + " 2000, 300, '{}', now(), now(), 'changed_mind')",
        rideId,
        riderUserId,
        regionId,
        economy);
    return rideId;
  }
}
