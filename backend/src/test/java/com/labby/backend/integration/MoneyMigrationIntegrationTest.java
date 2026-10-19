package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M8-T1 acceptance: V12 migrates cleanly and the money invariants hold at the DATABASE level — the
 * three ledgers (wallet_transactions, driver_ledger, settlements) are append-only (triggers block
 * every UPDATE/DELETE), wallet balances never go negative (PAY-01), every entry is typed with the
 * right sign and itemization (COM-01), one tip per ride (PAY-04 ruling), settlements are 1:1 with
 * their ledger entry (COM-04), rider dues carry their collection state consistently
 * (cancellation-fee rail, owner ruling (a)), the region floor is never positive (COM-03), the new
 * wallet/mixed payment statuses land on rides (PAY-02), and a balance is always derivable as the
 * sum of its ledger entries. (The V12 rider-dues BACKFILL of M7-recorded fees runs against an empty
 * schema here and is exercised on real data only — dev/prod databases.)
 */
class MoneyMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID rider;
  private UUID driver;
  private UUID vehicle;
  private UUID admin;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Money IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    rider = newUser();
    driver = newUser();
    admin = newUser();
    vehicle = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'DM-M8', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
  }

  @AfterEach
  void cleanOwnRows() {
    // The ledgers are append-only by design; TRUNCATE bypasses row-level triggers (same approach
    // as audit_log in AbstractAuthIntegrationTest) so the shared test DB resets between tests.
    // M13 growth rows reference wallet_transactions (points) and each other, so they truncate
    // with the ledgers even though this class never creates them.
    jdbcTemplate.execute(
        "TRUNCATE challenge_progress, points_transactions, incentive_awards, driver_ledger,"
            + " wallet_transactions,"
            + " settlements");
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM rider_dues WHERE rider_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM wallet_balances WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM driver_balances WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM driver_commission_rates WHERE driver_user_id = ?", userId);
    }
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("the three money ledgers are append-only: every UPDATE and DELETE is blocked")
  void shouldBlockLedgerMutation() {
    UUID walletTx = insertGrant(rider, "10.00");
    UUID settlement = insertSettlement("25.00", "pay_in");
    UUID ledgerEntry = insertSettlementLedgerEntry(settlement, "25.00");

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE wallet_transactions SET amount = 99 WHERE wallet_transaction_id = ?",
                    walletTx))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM wallet_transactions WHERE wallet_transaction_id = ?", walletTx))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE settlements SET amount = 99 WHERE settlement_id = ?", settlement))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update("DELETE FROM settlements WHERE settlement_id = ?", settlement))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE driver_ledger SET amount = 99 WHERE driver_ledger_id = ?", ledgerEntry))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM driver_ledger WHERE driver_ledger_id = ?", ledgerEntry))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
  }

  @Test
  @DisplayName("PAY-01: a wallet balance can never go negative, at the database")
  void shouldRejectNegativeWalletBalance() {
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO wallet_balances (user_id, currency, balance) VALUES (?, 'SYP',"
                        + " -0.01)",
                    rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_balances_non_negative");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO wallet_transactions (user_id, currency, amount, type, created_by,"
                        + " reason, balance_after) VALUES (?, 'SYP', 5.00, 'admin_grant', ?, 'r',"
                        + " -5.00)",
                    rider,
                    admin))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_transactions_balance");
  }

  @Test
  @DisplayName("wallet entries are typed with the right sign, links and admin fields")
  void shouldEnforceWalletTransactionShape() {
    // A credit type with a negative amount is refused (and vice versa).
    assertThatThrownBy(() -> insertWalletTx(rider, "-5.00", "admin_grant", null, admin, "r"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_transactions_sign");
    // A grant without created_by + reason is refused.
    assertThatThrownBy(() -> insertWalletTx(rider, "5.00", "admin_grant", null, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_transactions_admin");
    // A refund must be ride-linked (PAY-03).
    assertThatThrownBy(() -> insertWalletTx(rider, "5.00", "refund", null, admin, "r"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_transactions_refund_link");
    // Ride money types must carry their ride.
    assertThatThrownBy(() -> insertWalletTx(rider, "-5.00", "fare_payment", null, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_wallet_transactions_ride_types");
    // One tip per ride (owner ruling).
    UUID ride = insertRide(rider);
    insertGrant(rider, "10.00");
    insertWalletTx(rider, "-2.00", "tip", ride, null, null);
    assertThatThrownBy(() -> insertWalletTx(rider, "-1.00", "tip", ride, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_wallet_transactions_tip");
  }

  @Test
  @DisplayName("COM-01: driver ledger entries are itemized per type; one fare entry per ride")
  void shouldEnforceDriverLedgerShape() {
    UUID ride = insertRide(rider);
    // ride_earning without itemization is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id,"
                        + " balance_after) VALUES (?, 'SYP', 3.00, 'ride_earning', ?, 3.00)",
                    driver,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_ledger_itemized");
    // commission_due must be a debit.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id,"
                        + " fare_amount, commission_rate, commission_amount, balance_after) VALUES"
                        + " (?, 'SYP', 1.00, 'commission_due', ?, 4.00, 25.00, 1.00, 1.00)",
                    driver,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_ledger_sign");
    // A settlement-typed entry without its settlements row is refused (1:1, COM-04).
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_ledger (driver_user_id, currency, amount, type,"
                        + " balance_after) VALUES (?, 'SYP', 25.00, 'settlement_pay_in', 25.00)",
                    driver))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_ledger_settlement");
    // due_collection must name the due it collected.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id,"
                        + " balance_after) VALUES (?, 'SYP', -2.00, 'due_collection', ?, -2.00)",
                    driver,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_ledger_due_collection");
    // Exactly one fare entry (earning OR commission debit) per ride.
    jdbcTemplate.update(
        "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id, fare_amount,"
            + " commission_rate, commission_amount, balance_after) VALUES (?, 'SYP', 3.00,"
            + " 'ride_earning', ?, 4.00, 25.00, 1.00, 3.00)",
        driver,
        ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id,"
                        + " fare_amount, commission_rate, commission_amount, balance_after) VALUES"
                        + " (?, 'SYP', -1.00, 'commission_due', ?, 4.00, 25.00, 1.00, 2.00)",
                    driver,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_ledger_ride_fare");
  }

  @Test
  @DisplayName("balances equal their ledger sums (wallet and driver), demonstrated over a sequence")
  void shouldDeriveBalancesFromLedgers() {
    UUID ride = insertRide(rider);
    insertGrant(rider, "10.00");
    insertWalletTx(rider, "-3.50", "fare_payment", ride, null, null);
    insertWalletTx(rider, "-2.00", "tip", ride, null, null);
    jdbcTemplate.update(
        "UPDATE wallet_balances SET balance = 4.50, updated_at = now() WHERE user_id = ? AND"
            + " currency = 'SYP'",
        rider);

    BigDecimal walletSum =
        jdbcTemplate.queryForObject(
            "SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE user_id = ? AND"
                + " currency = 'SYP'",
            BigDecimal.class,
            rider);
    BigDecimal walletBalance =
        jdbcTemplate.queryForObject(
            "SELECT balance FROM wallet_balances WHERE user_id = ? AND currency = 'SYP'",
            BigDecimal.class,
            rider);
    assertThat(walletSum).isEqualByComparingTo(walletBalance).isEqualByComparingTo("4.50");

    UUID settlement = insertSettlement("25.00", "pay_in");
    jdbcTemplate.update(
        "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id, fare_amount,"
            + " commission_rate, commission_amount, balance_after) VALUES (?, 'SYP', -1.00,"
            + " 'commission_due', ?, 4.00, 25.00, 1.00, -1.00)",
        driver,
        ride);
    insertSettlementLedgerEntry(settlement, "25.00");
    jdbcTemplate.update(
        "INSERT INTO driver_balances (driver_user_id, currency, balance) VALUES (?, 'SYP', 24.00)",
        driver);

    BigDecimal ledgerSum =
        jdbcTemplate.queryForObject(
            "SELECT COALESCE(SUM(amount), 0) FROM driver_ledger WHERE driver_user_id = ? AND"
                + " currency = 'SYP'",
            BigDecimal.class,
            driver);
    BigDecimal driverBalance =
        jdbcTemplate.queryForObject(
            "SELECT balance FROM driver_balances WHERE driver_user_id = ? AND currency = 'SYP'",
            BigDecimal.class,
            driver);
    assertThat(ledgerSum).isEqualByComparingTo(driverBalance).isEqualByComparingTo("24.00");
  }

  @Test
  @DisplayName("rider dues: one per cancelled ride, positive, collection state consistent")
  void shouldEnforceRiderDueShape() {
    UUID cancelled = insertRide(rider);
    // The source ride is a fee-bearing cancellation (also frees the rider's active-ride slot).
    jdbcTemplate.update(
        "UPDATE rides SET state = 'cancelled_by_rider', cancelled_at = now(),"
            + " cancellation_reason = 'changed_mind', cancellation_fee = 2.00 WHERE ride_id = ?",
        cancelled);
    UUID due = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rider_dues (rider_due_id, rider_user_id, currency, amount, source_ride_id)"
            + " VALUES (?, ?, 'SYP', 2.00, ?)",
        due,
        rider,
        cancelled);
    // A second due for the same source ride is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO rider_dues (rider_user_id, currency, amount, source_ride_id)"
                        + " VALUES (?, 'SYP', 2.00, ?)",
                    rider,
                    cancelled))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_rider_dues_source");
    // collected without the collecting ride + moment is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rider_dues SET status = 'collected' WHERE rider_due_id = ?", due))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rider_dues_collected");
    UUID next = insertRide(rider);
    jdbcTemplate.update(
        "UPDATE rider_dues SET status = 'collected', collected_ride_id = ?, collected_at = now()"
            + " WHERE rider_due_id = ?",
        next,
        due);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM rider_dues WHERE rider_due_id = ?", String.class, due))
        .isEqualTo("collected");
  }

  @Test
  @DisplayName("COM-03: the region floor is never positive; commission rates are one per week")
  void shouldEnforceFloorAndCommissionRates() {
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE regions SET driver_balance_floor = 1 WHERE region_id = ?", regionId))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_regions_driver_balance_floor");
    jdbcTemplate.update(
        "UPDATE regions SET driver_balance_floor = -50 WHERE region_id = ?", regionId);

    jdbcTemplate.update(
        "INSERT INTO driver_commission_rates (driver_user_id, region_id, week_start, percent,"
            + " weekly_trips) VALUES (?, ?, '2026-10-05', 20.00, 120)",
        driver,
        regionId);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO driver_commission_rates (driver_user_id, region_id, week_start,"
                        + " percent, weekly_trips) VALUES (?, ?, '2026-10-05', 15.00, 220)",
                    driver,
                    regionId))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_commission_rates");
  }

  @Test
  @DisplayName("PAY-02: completed rides accept paid_wallet / paid_mixed, confirmed like paid_cash")
  void shouldAcceptWalletPaymentStatuses() {
    for (String status : List.of("paid_wallet", "paid_mixed")) {
      UUID ride = insertCompletedRide();
      // The new statuses require their confirmation moment, like paid_cash.
      assertThatThrownBy(
              () ->
                  jdbcTemplate.update(
                      "UPDATE rides SET payment_status = ? WHERE ride_id = ?", status, ride))
          .isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("ck_rides_payment_confirmed");
      jdbcTemplate.update(
          "UPDATE rides SET payment_status = ?, payment_confirmed_at = now() WHERE ride_id = ?",
          status,
          ride);
      assertThat(
              jdbcTemplate.queryForObject(
                  "SELECT payment_status FROM rides WHERE ride_id = ?", String.class, ride))
          .isEqualTo(status);
    }
  }

  private UUID insertRide(UUID riderId) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, pickup,"
            + " destination, payment_method, pickup_distance_mode, currency, estimate_total,"
            + " estimate_distance_m, estimate_duration_s, estimate_components) VALUES (?, ?, ?, ?,"
            + " ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID insertCompletedRide() {
    // A completed ride needs a fresh rider: one active ride per rider is enforced elsewhere, but
    // the walk below leaves nothing active, so reusing the rider is fine too — fresh keeps tests
    // independent.
    UUID rideId = insertRide(newUser());
    jdbcTemplate.update(
        "UPDATE rides SET state = 'completed', offering_at = now(), accepted_at = now(),"
            + " started_at = now(), completed_at = now(), driver_user_id = ?, vehicle_id = ?,"
            + " payment_status = 'pending' WHERE ride_id = ?",
        driver,
        vehicle,
        rideId);
    return rideId;
  }

  /** Grants into the wallet and creates/updates the balance row like the T2 service will. */
  private UUID insertGrant(UUID userId, String amount) {
    jdbcTemplate.update(
        "INSERT INTO wallet_balances (user_id, currency, balance) VALUES (?, 'SYP', ?::numeric)"
            + " ON CONFLICT (user_id, currency) DO UPDATE SET balance = wallet_balances.balance"
            + " + EXCLUDED.balance",
        userId,
        amount);
    return insertWalletTx(userId, amount, "admin_grant", null, admin, "test grant");
  }

  private UUID insertWalletTx(
      UUID userId, String amount, String type, UUID rideId, UUID createdBy, String reason) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO wallet_transactions (wallet_transaction_id, user_id, currency, amount, type,"
            + " ride_id, created_by, reason, balance_after) VALUES (?, ?, 'SYP', ?::numeric, ?, ?,"
            + " ?, ?, GREATEST((SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE"
            + " user_id = ?) + ?::numeric, 0))",
        id,
        userId,
        amount,
        type,
        rideId,
        createdBy,
        reason,
        userId,
        amount);
    return id;
  }

  private UUID insertSettlement(String amount, String direction) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO settlements (settlement_id, driver_user_id, currency, amount, direction,"
            + " note, recorded_by) VALUES (?, ?, 'SYP', ?::numeric, ?, 'test', ?)",
        id,
        driver,
        amount,
        direction,
        admin);
    return id;
  }

  private UUID insertSettlementLedgerEntry(UUID settlementId, String amount) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO driver_ledger (driver_ledger_id, driver_user_id, currency, amount, type,"
            + " settlement_id, balance_after) VALUES (?, ?, 'SYP', ?::numeric,"
            + " 'settlement_pay_in', ?, ?::numeric)",
        id,
        driver,
        amount,
        settlementId,
        amount);
    return id;
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Money Test User', now())",
        userId,
        "+9637%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
