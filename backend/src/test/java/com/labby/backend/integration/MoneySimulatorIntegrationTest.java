package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labby.backend.config.RideSimProperties;
import com.labby.backend.runner.DevRideSimulator;
import com.labby.backend.service.CommissionService;
import com.labby.backend.service.DriverAvailabilityService;
import com.labby.backend.service.DriverLocationService;
import com.labby.backend.service.DriverRideService;
import com.labby.backend.service.RoutingProvider;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

/**
 * M8-T6 acceptance — the money flows end to end on the dev driver-simulation harness: the simulator
 * performs every driver action (accept, drive, arrive, start, complete, cash confirm) through the
 * real services; the test acts only as the rider and the admin over REST, on the controlled clock.
 * Fares are metered from the simulated drive, so amounts are asserted from each ride's stored fare
 * (commission = fare × rate, HALF_UP 2 dp), never from constants. Every scenario ends with the
 * traceability sweep (every ledger line links to its ride / settlement / due / admin action) and
 * the balance = ledger-sum invariants.
 */
class MoneySimulatorIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final String SIM_PHONE = "+963937911111";

  @Autowired private DriverAvailabilityService driverAvailabilityService;
  @Autowired private DriverLocationService driverLocationService;
  @Autowired private DriverRideService driverRideService;
  @Autowired private RoutingProvider routingProvider;
  @Autowired private CommissionService commissionService;

  private Account sim;
  private DevRideSimulator simulator;

  @BeforeEach
  void startSimulator() {
    // An approved driver, OFFLINE with NO position: the simulator brings it online and streams.
    sim = approvedDriver(SIM_PHONE, "SIM-1", economy, admin);
    simulator =
        new DevRideSimulator(
            new RideSimProperties(
                true, 1000, 3600, 1, 1, List.of(SIM_PHONE), PICKUP_LAT, PICKUP_LNG),
            jdbcTemplate,
            driverAvailabilityService,
            driverLocationService,
            driverRideService,
            routingProvider,
            CLOCK);
  }

  @Test
  @DisplayName("PAY-02/04 + PAY-03: wallet-paid ride, tip, mixed-payment ride and a ride refund")
  void shouldPayFromWalletTipSplitAndRefund() {
    // Wallet-paid: a covering wallet pays the whole fare, no cash step for the driver.
    Account rider = rider();
    grant(rider.userId(), "50.00");
    UUID paid = simulateRide(rider, "wallet");
    assertThat(paymentStatus(paid)).isEqualTo("paid_wallet");
    BigDecimal paidFare = fareTotal(paid);
    JsonNode paidView = riderRide(rider, paid);
    assertThat(paidView.get("walletApplied").decimalValue()).isEqualByComparingTo(paidFare);
    assertThat(paidView.get("cashDue").decimalValue()).isEqualByComparingTo("0");
    assertThat(walletBalance(rider.userId()))
        .isEqualByComparingTo(new BigDecimal("50.00").subtract(paidFare));
    assertFareEntry(paid, paidFare, "25");

    // Tip after completion: wallet debit, 100% to the driver, both linked to the ride.
    JsonNode tipped =
        ok(
            post("/api/v1/rides/" + paid + "/tip", Map.of("amount", "3.00"), rider.token()),
            HttpStatus.CREATED);
    assertThat(tipped.get("amount").decimalValue()).isEqualByComparingTo("3.00");
    assertThat(rowsOf(walletTransactions(rider.userId()), "tip"))
        .singleElement()
        .satisfies(row -> assertLinked(row, paid, "-3.00"));
    assertThat(rowsOf(driverLedger(sim.userId()), "tip"))
        .singleElement()
        .satisfies(row -> assertLinked(row, paid, "3.00"));

    // Mixed: a short wallet is drained exactly, the rest is cash the simulator confirms.
    Account mixedRider = rider();
    grant(mixedRider.userId(), "1.00");
    UUID mixed = simulateRide(mixedRider, "wallet");
    assertThat(paymentStatus(mixed)).isEqualTo("paid_mixed");
    BigDecimal mixedFare = fareTotal(mixed);
    JsonNode mixedView = riderRide(mixedRider, mixed);
    assertThat(mixedView.get("walletApplied").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(mixedView.get("cashDue").decimalValue())
        .isEqualByComparingTo(mixedFare.subtract(new BigDecimal("1.00")));
    assertThat(walletBalance(mixedRider.userId())).isEqualByComparingTo("0");
    // ONE netted fare entry: walletApplied − commission (sign decides earning vs debit).
    BigDecimal mixedCommission = commission(mixedFare, "25");
    BigDecimal net = new BigDecimal("1.00").subtract(mixedCommission);
    List<Map<String, Object>> mixedEntries = rideFareEntries(mixed);
    if (net.signum() == 0) {
      assertThat(mixedEntries).isEmpty();
    } else {
      assertThat(mixedEntries)
          .singleElement()
          .satisfies(
              entry -> {
                assertThat(entry.get("type"))
                    .isEqualTo(net.signum() > 0 ? "ride_earning" : "commission_due");
                assertThat((BigDecimal) entry.get("amount")).isEqualByComparingTo(net);
                assertThat((BigDecimal) entry.get("commission_amount"))
                    .isEqualByComparingTo(mixedCommission);
              });
    }

    // Refund on the mixed ride: admin-issued, reasoned and linked to that ride.
    JsonNode refund =
        ok(
            post(
                "/api/v1/admin/users/" + mixedRider.userId() + "/wallet/credits",
                Map.of(
                    "type", "refund",
                    "amount", "0.75",
                    "currency", "SYP",
                    "reason", "route detour",
                    "rideId", mixed.toString()),
                admin),
            HttpStatus.CREATED);
    assertThat(refund.get("rideId").asText()).isEqualTo(mixed.toString());
    assertThat(rowsOf(walletTransactions(mixedRider.userId()), "refund"))
        .singleElement()
        .satisfies(row -> assertLinked(row, mixed, "0.75"));
    assertThat(walletBalance(mixedRider.userId())).isEqualByComparingTo("0.75");

    assertTraceable();
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("COM-01/03: cash debt accumulates to the floor, blocks offers; settlement unblocks")
  void shouldBlockAtFloorAndUnblockOnSettlement() {
    Account rider = rider();
    UUID first = simulateRide(rider, "cash");
    assertThat(paymentStatus(first)).isEqualTo("paid_cash");
    BigDecimal firstCommission = commission(fareTotal(first), "25");
    assertFareEntry(first, fareTotal(first), "25");
    BigDecimal afterFirst = driverBalance(sim.userId());
    assertThat(afterFirst).isEqualByComparingTo(firstCommission.negate());

    // The admin sets the region floor between one and two rides of debt.
    BigDecimal floor = afterFirst.multiply(new BigDecimal("1.5")).setScale(2, RoundingMode.HALF_UP);
    updateRegion(region -> region.put("driverBalanceFloor", floor));
    assertThat(floorStatus()).isNotEqualTo("blocked");

    UUID second = simulateRide(rider, "cash");
    assertThat(paymentStatus(second)).isEqualTo("paid_cash");
    assertThat(driverBalance(sim.userId()))
        .isEqualByComparingTo(afterFirst.subtract(commission(fareTotal(second), "25")));
    assertThat(floorStatus()).isEqualTo("blocked");
    JsonNode availability = ok(get("/api/v1/driver/availability", sim.token()), HttpStatus.OK);
    assertThat(availability.get("online").asBoolean()).isTrue();
    assertThat(availability.get("offersBlockedReason").asText()).isEqualTo("balance_below_floor");

    // Online and streaming, yet never offered: the only driver is blocked → no_driver_found.
    UUID refused = simulateRide(rider, "cash");
    assertThat(stateOf(refused)).isEqualTo("no_driver_found");
    assertThat(offerResponses(refused)).isEmpty();

    // Settlement at the Labby office clears the debt and lifts the block.
    BigDecimal owed = driverBalance(sim.userId()).negate();
    JsonNode settled =
        ok(
            post(
                "/api/v1/admin/drivers/" + sim.userId() + "/settlements",
                Map.of(
                    "amount", owed.toPlainString(),
                    "direction", "pay_in",
                    "currency", "SYP",
                    "note", "cash desk"),
                admin),
            HttpStatus.CREATED);
    assertThat(settled.get("balance").decimalValue()).isEqualByComparingTo("0");
    // Unblocked; still "warning" because 0 sits within the default margin (10) above this tiny
    // test floor — the margin is sized for real SYP floors.
    assertThat(settled.get("floorStatus").asText()).isEqualTo("warning");
    assertThat(
            ok(get("/api/v1/driver/availability", sim.token()), HttpStatus.OK)
                .get("offersBlockedReason")
                .isNull())
        .isTrue();
    assertThat(rowsOf(driverLedger(sim.userId()), "settlement_pay_in")).hasSize(1);

    UUID resumed = simulateRide(rider, "cash");
    assertThat(paymentStatus(resumed)).isEqualTo("paid_cash");

    assertTraceable();
    assertLedgerInvariants();
  }

  @Test
  @DisplayName(
      "RIDE-07 + owner ruling: a cancellation fee short of the wallet becomes a due, collected in"
          + " cash on the next ride; the cancelled ride's driver gets the full fee once")
  void shouldCollectCancellationDueOnNextRide() {
    Account rider = rider();
    grant(rider.userId(), "0.50");

    // Wallet-method ride, accepted by the simulator, cancelled by the rider after the grace.
    JsonNode booked = ok(tryBook(rider, booking("wallet")), HttpStatus.CREATED);
    UUID cancelled = UUID.fromString(booked.get("id").asText());
    tickUntil(cancelled, () -> "accepted".equals(stateOf(cancelled)));
    advance(Duration.ofMinutes(3)); // region grace is 2 min
    JsonNode cancel =
        ok(
            post(
                "/api/v1/rides/" + cancelled + "/cancel",
                Map.of("reason", "changed_mind"),
                rider.token()),
            HttpStatus.OK);
    assertThat(cancel.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    // The wallet pays what it can; the 1.50 remainder is a pending due, nothing to the driver yet.
    assertThat(rowsOf(walletTransactions(rider.userId()), "cancellation_fee"))
        .singleElement()
        .satisfies(row -> assertLinked(row, cancelled, "-0.50"));
    assertThat(dues(rider.userId()))
        .singleElement()
        .satisfies(
            due -> {
              assertThat(due.get("status")).isEqualTo("pending");
              assertThat((BigDecimal) due.get("amount")).isEqualByComparingTo("1.50");
            });
    assertThat(driverLedger(sim.userId())).isEmpty();

    // The next (cash) ride carries the due; the simulator collects it with the fare.
    UUID next = simulateRide(rider, "cash");
    assertThat(paymentStatus(next)).isEqualTo("paid_cash");
    JsonNode nextView = riderRide(rider, next);
    assertThat(nextView.get("cashDue").decimalValue())
        .isEqualByComparingTo(fareTotal(next).add(new BigDecimal("1.50")));
    Map<String, Object> due = dues(rider.userId()).get(0);
    assertThat(due.get("status")).isEqualTo("collected");
    assertThat(due.get("collected_ride_id")).isEqualTo(next);
    UUID dueId = (UUID) due.get("rider_due_id");

    List<Map<String, Object>> ledger = driverLedger(sim.userId());
    assertThat(rowsOf(ledger, "due_collection"))
        .singleElement()
        .satisfies(
            row -> {
              assertLinked(row, next, "-1.50");
              assertThat(row.get("rider_due_id")).isEqualTo(dueId);
            });
    assertThat(rowsOf(ledger, "cancellation_fee"))
        .singleElement()
        .satisfies(
            row -> {
              assertLinked(row, cancelled, "2.00");
              assertThat(row.get("rider_due_id")).isEqualTo(dueId);
            });
    assertFareEntry(next, fareTotal(next), "25");

    assertTraceable();
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("COM-02: the weekly recalc on the controlled clock moves the driver to a lower tier")
  void shouldRecalcWeeklyTierOnControlledClock() {
    ZoneId zone = ZoneId.of("Asia/Damascus");
    // Mid-week noon, so this week's rides never straddle a week boundary.
    CLOCK.set(
        LocalDate.ofInstant(CLOCK.instant(), zone)
            .with(TemporalAdjusters.next(DayOfWeek.WEDNESDAY))
            .atTime(12, 0)
            .atZone(zone)
            .toInstant());
    updateRegion(
        region -> {
          ArrayNode tiers = region.putArray("commissionTiers");
          tier(tiers, 0, "25");
          tier(tiers, 2, "20"); // more than 2 trips last week → 20%
        });

    Account rider = rider();
    for (int i = 0; i < 3; i++) {
      UUID rideId = simulateRide(rider, "cash");
      assertFareEntry(rideId, fareTotal(rideId), "25");
    }

    // Across the Monday boundary (region time zone) the weekly job recalculates.
    LocalDate nextMonday =
        LocalDate.ofInstant(CLOCK.instant(), zone).with(TemporalAdjusters.next(DayOfWeek.MONDAY));
    CLOCK.set(nextMonday.atTime(1, 0).atZone(zone).toInstant());
    assertThat(commissionService.recalcWeeklyRates()).isPositive();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT percent FROM driver_commission_rates WHERE driver_user_id = ? AND"
                    + " region_id = ? AND week_start = ?",
                BigDecimal.class,
                sim.userId(),
                regionId,
                nextMonday))
        .isEqualByComparingTo("20");

    UUID afterRecalc = simulateRide(rider, "cash");
    assertFareEntry(afterRecalc, fareTotal(afterRecalc), "20");
    JsonNode commission =
        ok(get("/api/v1/driver/balance", sim.token()), HttpStatus.OK).get("commission");
    assertThat(commission.get("percent").decimalValue()).isEqualByComparingTo("20");
    assertThat(commission.get("weekStart").asText()).isEqualTo(nextMonday.toString());
    assertThat(commission.get("weeklyTrips").asInt()).isEqualTo(3);

    assertTraceable();
    assertLedgerInvariants();
  }

  // ---- harness -------------------------------------------------------------------------------

  /**
   * Books with the method and lets the simulator do every driver action; returns once the ride is
   * settled (completed and no longer payment-pending) or ended without a driver.
   */
  private UUID simulateRide(Account rider, String paymentMethod) {
    JsonNode ride = ok(tryBook(rider, booking(paymentMethod)), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(ride.get("id").asText());
    tickUntil(
        rideId,
        () -> {
          String state = stateOf(rideId);
          return "no_driver_found".equals(state)
              || ("completed".equals(state) && !"pending".equals(paymentStatus(rideId)));
        });
    return rideId;
  }

  /** The dev-stack rhythm: the simulator ticks (online + streaming) before each dispatch pass. */
  private void tickUntil(UUID rideId, java.util.function.BooleanSupplier done) {
    for (int tick = 0; tick < 120; tick++) {
      advance(Duration.ofSeconds(1));
      simulator.tick();
      dispatch();
      if (done.getAsBoolean()) {
        return;
      }
    }
    throw new AssertionError(
        "ride %s stuck in %s / %s".formatted(rideId, stateOf(rideId), paymentStatus(rideId)));
  }

  /**
   * Full-replace region PUT built from the admin GET. The SQL-seeded fixture region is active but
   * lacks the mandatory bundle parts an admin save requires (UC-A-06), so they are completed with
   * the defaults that already apply (base tiers 25/20/15) and placeholder incentive/suspension
   * values (no money effect); then the edit applies.
   */
  private void updateRegion(Consumer<ObjectNode> edit) {
    String url = "/api/v1/admin/regions/" + regionId;
    ObjectNode region = (ObjectNode) ok(get(url, admin), HttpStatus.OK);
    region.remove(List.of("id", "state", "serviceTypeCount", "surgeZoneCount"));
    if (region.path("commissionTiers").isEmpty()) {
      ArrayNode tiers = region.putArray("commissionTiers");
      tier(tiers, 0, "25");
      tier(tiers, 100, "20");
      tier(tiers, 200, "15");
    }
    if (region.path("incentiveValues").isNull()) {
      ObjectNode incentives = region.putObject("incentiveValues");
      incentives.putArray("weeklyTripBonuses").addObject().put("trips", 40).put("amount", 50);
      incentives.put("peakHourBonusPerTrip", 1.0);
      incentives
          .putObject("ratingReward")
          .put("amount", 20)
          .put("minAvgRating", 4.8)
          .put("minWeeklyTrips", 30);
    }
    if (region.path("suspensionThresholds").isNull()) {
      ObjectNode thresholds = region.putObject("suspensionThresholds");
      thresholds.putObject("driver").put("minAvgRating", 3.0).put("minRatedRides", 20);
      thresholds.putObject("rider").put("minAvgRating", 2.5).put("minRatedRides", 10);
    }
    edit.accept(region);
    ok(put(url, region, admin), HttpStatus.OK);
  }

  private static void tier(ArrayNode tiers, int weeklyTripsAbove, String percent) {
    tiers
        .addObject()
        .put("weeklyTripsAbove", weeklyTripsAbove)
        .put("percent", new BigDecimal(percent));
  }

  private String floorStatus() {
    JsonNode balances =
        ok(get("/api/v1/driver/balance", sim.token()), HttpStatus.OK).get("balances");
    return balances.get(0).get("status").asText();
  }

  private String paymentStatus(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_status FROM rides WHERE ride_id = ?", String.class, rideId);
  }

  private BigDecimal fareTotal(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT total FROM fares WHERE ride_id = ?", BigDecimal.class, rideId);
  }

  private static BigDecimal commission(BigDecimal fare, String percent) {
    return fare.multiply(new BigDecimal(percent))
        .divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP);
  }

  /** The ride's fare entries (ride_earning / commission_due) on the simulated driver's ledger. */
  private List<Map<String, Object>> rideFareEntries(UUID rideId) {
    return driverLedger(sim.userId()).stream()
        .filter(row -> rideId.equals(row.get("ride_id")))
        .filter(row -> List.of("ride_earning", "commission_due").contains(row.get("type")))
        .toList();
  }

  /** A cash ride's single fare entry: −commission at the rate, itemized with the stored fare. */
  private void assertFareEntry(UUID rideId, BigDecimal fare, String percent) {
    BigDecimal commission = commission(fare, percent);
    String method =
        jdbcTemplate.queryForObject(
            "SELECT payment_method FROM rides WHERE ride_id = ?", String.class, rideId);
    BigDecimal expected = "cash".equals(method) ? commission.negate() : fare.subtract(commission);
    assertThat(rideFareEntries(rideId))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat((BigDecimal) entry.get("amount")).isEqualByComparingTo(expected);
              assertThat((BigDecimal) entry.get("fare_amount")).isEqualByComparingTo(fare);
              assertThat((BigDecimal) entry.get("commission_rate")).isEqualByComparingTo(percent);
              assertThat((BigDecimal) entry.get("commission_amount"))
                  .isEqualByComparingTo(commission);
            });
  }

  private static List<Map<String, Object>> rowsOf(List<Map<String, Object>> rows, String type) {
    return rows.stream().filter(row -> type.equals(row.get("type"))).toList();
  }

  private static void assertLinked(Map<String, Object> row, UUID rideId, String amount) {
    assertThat(row.get("ride_id")).isEqualTo(rideId);
    assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo(amount);
  }

  private List<Map<String, Object>> dues(UUID riderUserId) {
    return jdbcTemplate.queryForList(
        "SELECT rider_due_id, amount, status, collected_ride_id FROM rider_dues"
            + " WHERE rider_user_id = ? ORDER BY created_at",
        riderUserId);
  }

  /**
   * AC "every ledger line traceable to its ride/action": each driver line links the ride it belongs
   * to (a ride of THAT driver, or the cancelled ride a collected due paid for), its settlement or
   * its due; each wallet line links a ride of THAT rider, or — for grants — the issuing admin and
   * reason. Orphans fail with the offending rows.
   */
  private void assertTraceable() {
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT l.* FROM driver_ledger l LEFT JOIN rides r ON r.ride_id = l.ride_id WHERE"
                    + " CASE l.type"
                    + "  WHEN 'settlement_pay_in' THEN l.settlement_id IS NULL"
                    + "  WHEN 'settlement_pay_out' THEN l.settlement_id IS NULL"
                    + "  WHEN 'due_collection' THEN r.ride_id IS NULL OR l.rider_due_id IS NULL"
                    + "   OR r.driver_user_id <> l.driver_user_id"
                    + "  ELSE r.ride_id IS NULL OR r.driver_user_id <> l.driver_user_id"
                    + "   OR (l.type IN ('ride_earning', 'commission_due')"
                    + "       AND (l.fare_amount IS NULL OR l.commission_rate IS NULL))"
                    + " END"))
        .as("untraceable driver ledger lines")
        .isEmpty();
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT t.* FROM wallet_transactions t LEFT JOIN rides r ON r.ride_id = t.ride_id"
                    + " WHERE CASE t.type"
                    + "  WHEN 'admin_grant' THEN t.created_by IS NULL OR t.reason IS NULL"
                    + "  WHEN 'refund' THEN t.created_by IS NULL OR t.reason IS NULL"
                    + "   OR r.ride_id IS NULL OR r.rider_user_id <> t.user_id"
                    + "  ELSE r.ride_id IS NULL OR r.rider_user_id <> t.user_id"
                    + " END"))
        .as("untraceable wallet lines")
        .isEmpty();
    assertThat(jdbcTemplate.queryForObject("SELECT count(*) FROM driver_ledger", Long.class))
        .as("the sweep saw ledger lines")
        .isPositive();
  }
}
