package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.CommissionService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

/**
 * COM-02 on a controlled clock: the weekly recalc computes each driver's rate from the PREVIOUS
 * Monday-start week's completed trips in the region — tier boundaries at 99/100/101 and 199/200/201
 * ("above" is strictly greater), idempotent inserts — and the new rate drives the next completion's
 * posting.
 */
class CommissionTierIntegrationTest extends AbstractMoneyIntegrationTest {

  @Autowired private CommissionService commissionService;

  @Test
  @DisplayName(
      "COM-02: 99/100/101 and 199/200/201 previous-week trips land on 25/25/20 and"
          + " 20/20/15; the recalc is idempotent and the rate applies to the next completion")
  void shouldRecalcTiersOnBoundaries() {
    Account driver101 = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID vehicle =
        jdbcTemplate.queryForObject(
            "SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?",
            UUID.class,
            driver101.userId());
    Map<UUID, Integer> trips = new java.util.LinkedHashMap<>();
    trips.put(registerWithoutPhoto("+963937811001", "D 99").userId(), 99);
    trips.put(registerWithoutPhoto("+963937811002", "D 100").userId(), 100);
    trips.put(driver101.userId(), 101);
    trips.put(registerWithoutPhoto("+963937811003", "D 199").userId(), 199);
    trips.put(registerWithoutPhoto("+963937811004", "D 200").userId(), 200);
    trips.put(registerWithoutPhoto("+963937811005", "D 201").userId(), 201);

    ZoneId zone = ZoneId.of("Asia/Damascus");
    LocalDate weekStart =
        LocalDate.ofInstant(CLOCK.instant(), zone).with(java.time.DayOfWeek.MONDAY);
    var completedAt =
        weekStart.minusDays(7).atStartOfDay(zone).plusHours(30).toInstant(); // midweek, prev week
    for (Map.Entry<UUID, Integer> entry : trips.entrySet()) {
      insertCompletedRides(entry.getKey(), vehicle, entry.getValue(), completedAt);
    }

    assertThat(commissionService.recalcWeeklyRates()).isEqualTo(6);
    assertThat(commissionService.recalcWeeklyRates()).isZero(); // idempotent: rows kept

    Map<UUID, BigDecimal> expected = new java.util.LinkedHashMap<>();
    List<UUID> drivers = List.copyOf(trips.keySet());
    List<String> percents = List.of("25", "25", "20", "20", "20", "15");
    for (int i = 0; i < drivers.size(); i++) {
      expected.put(drivers.get(i), new BigDecimal(percents.get(i)));
    }
    for (Map.Entry<UUID, BigDecimal> entry : expected.entrySet()) {
      assertThat(
              jdbcTemplate.queryForObject(
                  "SELECT percent FROM driver_commission_rates WHERE driver_user_id = ? AND"
                      + " region_id = ? AND week_start = ?",
                  BigDecimal.class,
                  entry.getKey(),
                  regionId,
                  weekStart))
          .as("driver with %s previous-week trips", trips.get(entry.getKey()))
          .isEqualByComparingTo(entry.getValue());
    }

    // The 101-trip driver's NEXT completion posts at 20%: commission 1.50 × 20% = 0.30.
    Account rider = rider();
    position(driver101, PICKUP_LAT, PICKUP_LNG);
    completeRide(rider, driver101, "cash");
    List<Map<String, Object>> ledger = driverLedger(driver101.userId());
    Map<String, Object> fareEntry =
        ledger.stream()
            .filter(e -> e.get("type").equals("commission_due"))
            .findFirst()
            .orElseThrow();
    assertThat((BigDecimal) fareEntry.get("commission_rate")).isEqualByComparingTo("20");
    assertThat((BigDecimal) fareEntry.get("commission_amount")).isEqualByComparingTo("0.30");

    // UC-D-15: the balance view explains the tier and the next-tier progress.
    JsonNode balance = ok(get("/api/v1/driver/balance", driver101.token()), HttpStatus.OK);
    JsonNode commission = balance.get("commission");
    assertThat(commission.get("percent").decimalValue()).isEqualByComparingTo("20");
    assertThat(commission.get("weekStart").asText()).isEqualTo(weekStart.toString());
    assertThat(commission.get("weeklyTrips").asInt()).isEqualTo(101);
    // Next-tier progress tracks THIS week's trips (1 so far): the 20% tier needs > 100.
    assertThat(commission.get("currentWeekTrips").asInt()).isEqualTo(1);
    assertThat(commission.get("nextTier").get("percent").decimalValue()).isEqualByComparingTo("20");
    assertThat(commission.get("nextTier").get("weeklyTripsAbove").asInt()).isEqualTo(100);
  }

  @Test
  @DisplayName(
      "M8 audit W1: with NO recalc run, the balance view and the week's first completion already"
          + " use the previous week's tier — the completion stores the row once")
  void shouldComputeMissingWeekRateLazily() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID vehicle =
        jdbcTemplate.queryForObject(
            "SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?",
            UUID.class,
            driver.userId());
    ZoneId zone = ZoneId.of("Asia/Damascus");
    LocalDate weekStart =
        LocalDate.ofInstant(CLOCK.instant(), zone).with(java.time.DayOfWeek.MONDAY);
    insertCompletedRides(
        driver.userId(),
        vehicle,
        101,
        weekStart.minusDays(7).atStartOfDay(zone).plusHours(30).toInstant());
    String rateRows =
        "SELECT count(*) FROM driver_commission_rates WHERE driver_user_id = ? AND week_start = ?";

    // The status view computes the tier without writing a row.
    JsonNode before =
        ok(get("/api/v1/driver/balance", driver.token()), HttpStatus.OK).get("commission");
    assertThat(before.get("percent").decimalValue()).isEqualByComparingTo("20");
    assertThat(before.get("weeklyTrips").asInt()).isEqualTo(101);
    assertThat(jdbcTemplate.queryForObject(rateRows, Integer.class, driver.userId(), weekStart))
        .isZero();

    // The first completion of the week posts at 20% (not the 25% base) and stores the row.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    completeRide(rider(), driver, "cash");
    Map<String, Object> fareEntry =
        driverLedger(driver.userId()).stream()
            .filter(e -> e.get("type").equals("commission_due"))
            .findFirst()
            .orElseThrow();
    assertThat((BigDecimal) fareEntry.get("commission_rate")).isEqualByComparingTo("20");
    assertThat((BigDecimal) fareEntry.get("commission_amount")).isEqualByComparingTo("0.30");
    assertThat(jdbcTemplate.queryForObject(rateRows, Integer.class, driver.userId(), weekStart))
        .isEqualTo(1);
    // The job is now only a pre-warm: the row exists, nothing more is inserted for this driver.
    commissionService.recalcWeeklyRates();
    assertThat(jdbcTemplate.queryForObject(rateRows, Integer.class, driver.userId(), weekStart))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT weekly_trips FROM driver_commission_rates WHERE driver_user_id = ? AND"
                    + " week_start = ?",
                Integer.class,
                driver.userId(),
                weekStart))
        .isEqualTo(101);
  }

  /** Inserts {@code count} completed rides for the driver in the test region. */
  private void insertCompletedRides(
      UUID driverUserId, UUID vehicleId, int count, java.time.Instant completedAt) {
    UUID riderUserId = registerWithoutPhoto(nextTierPhone(), "Tier Rider").userId();
    java.sql.Timestamp at = java.sql.Timestamp.from(completedAt);
    List<Object[]> rows = new java.util.ArrayList<>();
    for (int i = 0; i < count; i++) {
      rows.add(
          new Object[] {
            UUID.randomUUID(),
            riderUserId,
            driverUserId,
            vehicleId,
            regionId,
            economy,
            at,
            at,
            at,
            at,
            at
          });
    }
    jdbcTemplate.batchUpdate(
        "INSERT INTO rides (ride_id, rider_user_id, driver_user_id, vehicle_id, region_id,"
            + " service_type_id, state, pickup, destination, payment_method,"
            + " pickup_distance_mode, currency, estimate_total, estimate_distance_m,"
            + " estimate_duration_s, estimate_components, requested_at, offering_at, accepted_at,"
            + " started_at, completed_at, payment_status) VALUES (?, ?, ?, ?, ?, ?, 'completed',"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.31, 33.51), 4326), 'cash', 'nearby_only', 'SYP', 1.50,"
            + " 2000, 300, '{}', ?, ?, ?, ?, ?, 'pending')",
        rows);
  }

  private int tierPhoneSequence;

  private String nextTierPhone() {
    return "+9639378120%02d".formatted(++tierPhoneSequence);
  }
}
