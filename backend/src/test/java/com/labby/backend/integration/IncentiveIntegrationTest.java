package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.IncentiveService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

/**
 * M15-T3 incentives engine (incentives-v1.yaml, DRV-08) on a controlled clock. The evaluated week
 * is Mon 12 – Sun 18 Oct 2026 in Asia/Damascus (UTC+3); the job runs Mon 19 Oct 00:30 local. Region
 * config: 50 @ 40+, 100 @ 60+ (not cumulative, Q2); peak 1.00 per trip requested Mon–Thu
 * 07:00–09:30 or Fri–Sat 22:00–02:00 (overnight, Q1); rating 20 @ avg ≥ 4.8 with ≥ 30 trips (Q4).
 */
class IncentiveIntegrationTest extends AbstractTrustIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");
  private static final Instant EVALUATION = local(2026, 10, 19, 0, 30);

  @Autowired private IncentiveService incentiveService;

  private Account rider;

  private static Instant local(int year, int month, int day, int hour, int minute) {
    return LocalDateTime.of(year, month, day, hour, minute).atZone(DAMASCUS).toInstant();
  }

  @BeforeEach
  void configureIncentives() {
    jdbcTemplate.update(
        "UPDATE regions SET time_zone = 'Asia/Damascus', incentive_values = ?::jsonb"
            + " WHERE region_id = ?",
        """
        {"weeklyTripBonuses":[{"trips":60,"amount":100},{"trips":40,"amount":50}],
         "peakHourBonusPerTrip":1.00,
         "peakWindows":[{"daysOfWeek":[1,2,3,4],"startsAt":"07:00:00","endsAt":"09:30:00"},
                        {"daysOfWeek":[5,6],"startsAt":"22:00:00","endsAt":"02:00:00"}],
         "ratingReward":{"amount":20,"minAvgRating":4.8,"minWeeklyTrips":30}}
        """,
        regionId);
    rider = newRider();
  }

  /** A completed trip requested at {@code requestedAt}, completed 30 min later. */
  private UUID trip(Account driver, Instant requestedAt) {
    return tripCompletedAt(driver, requestedAt, requestedAt.plusSeconds(1800));
  }

  private UUID tripCompletedAt(Account driver, Instant requestedAt, Instant completedAt) {
    Instant accepted = requestedAt.plusSeconds(60);
    return ride(
        rider.userId(),
        driver.userId(),
        "completed",
        accepted,
        accepted.plusSeconds(120),
        completedAt,
        null);
  }

  /** {@code count} trips on Tuesday 14 Oct from 12:00, one minute apart (outside every window). */
  private void offPeakTrips(Account driver, int count) {
    Instant start = local(2026, 10, 14, 12, 0);
    for (int i = 0; i < count; i++) {
      trip(driver, start.plusSeconds(60L * i));
    }
  }

  private List<Map<String, Object>> awards(Account driver) {
    return jdbcTemplate.queryForList(
        "SELECT a.kind, a.trips, a.threshold, a.avg_rating, a.amount, a.week_start, l.type,"
            + " l.amount AS ledger_amount FROM incentive_awards a JOIN driver_ledger l"
            + " ON l.driver_ledger_id = a.driver_ledger_id WHERE a.driver_user_id = ?"
            + " ORDER BY a.kind",
        driver.userId());
  }

  private BigDecimal amountOf(Account driver, String kind) {
    return awards(driver).stream()
        .filter(row -> kind.equals(row.get("kind")))
        .map(row -> (BigDecimal) row.get("amount"))
        .findFirst()
        .orElse(null);
  }

  @Test
  @DisplayName("weekly tiers on the boundaries: 39/40/41 and 59/60/61, highest tier only")
  void shouldPayTheHighestTierReached() {
    Map<Integer, String> expected =
        Map.of(39, "none", 40, "50.00", 41, "50.00", 59, "50.00", 60, "100.00", 61, "100.00");
    Map<Integer, Account> drivers = new java.util.TreeMap<>();
    for (int trips : expected.keySet()) {
      Account driver = newDriver();
      offPeakTrips(driver, trips);
      drivers.put(trips, driver);
    }
    CLOCK.set(EVALUATION);

    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isEqualTo(5);

    drivers.forEach(
        (trips, driver) -> {
          List<Map<String, Object>> rows = awards(driver);
          if ("none".equals(expected.get(trips))) {
            assertThat(rows).as("%d trips", trips).isEmpty();
            return;
          }
          assertThat(rows).as("%d trips", trips).hasSize(1);
          Map<String, Object> row = rows.get(0);
          assertThat(row.get("kind")).isEqualTo("weekly_trips");
          assertThat(row.get("trips")).isEqualTo(trips);
          assertThat(row.get("threshold")).isEqualTo(trips >= 60 ? 60 : 40);
          assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo(expected.get(trips));
          assertThat(row.get("type")).isEqualTo("bonus");
          assertThat((BigDecimal) row.get("ledger_amount"))
              .isEqualByComparingTo(expected.get(trips));
          assertThat(row.get("week_start").toString()).isEqualTo("2026-10-12");
          assertThat(outboxEvents(driver.userId())).contains("incentive.awarded");
        });
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("re-running the week pays nothing twice")
  void shouldBeIdempotent() {
    Account driver = newDriver();
    offPeakTrips(driver, 40);
    trip(driver, local(2026, 10, 13, 8, 0));
    CLOCK.set(EVALUATION);

    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isEqualTo(2);
    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION.plusSeconds(3600))).isZero();

    assertThat(awards(driver)).hasSize(2);
    assertThat(driverLedger(driver.userId())).hasSize(2);
    assertThat(outboxEvents(driver.userId()).stream().filter("incentive.awarded"::equals))
        .hasSize(2);
  }

  @Test
  @DisplayName("peak trips: requested inside a window (start in, end out), overnight windows")
  void shouldCountPeakTripsByRequestTime() {
    Account driver = newDriver();
    List<Instant> inside =
        List.of(
            local(2026, 10, 12, 7, 0), // Mon start, inclusive
            local(2026, 10, 15, 9, 29), // Thu just before the end
            local(2026, 10, 16, 22, 0), // Fri overnight window start
            local(2026, 10, 17, 1, 59), // Sat early morning: Friday's window
            local(2026, 10, 18, 1, 0)); // Sun early morning: Saturday's window
    List<Instant> outside =
        List.of(
            local(2026, 10, 12, 6, 59), // before Monday's window
            local(2026, 10, 12, 9, 30), // end, exclusive
            local(2026, 10, 15, 23, 0), // Thursday night (no overnight window on Thu)
            local(2026, 10, 17, 2, 0)); // Saturday 02:00, Friday's window ended
    inside.forEach(at -> trip(driver, at));
    outside.forEach(at -> trip(driver, at));
    CLOCK.set(EVALUATION);

    incentiveService.evaluatePreviousWeek(EVALUATION);

    assertThat(amountOf(driver, "peak_hours")).isEqualByComparingTo("5.00");
    assertThat(awards(driver).get(0).get("trips")).isEqualTo(5);
  }

  @Test
  @DisplayName("week edges: trips count by completion time in the region's zone")
  void shouldCountTripsByCompletionWeek() {
    Account early = newDriver();
    offPeakTrips(early, 39);
    // Requested Sunday 11 Oct (previous week), completed Monday 12 Oct 00:05: counts this week.
    tripCompletedAt(early, local(2026, 10, 11, 23, 40), local(2026, 10, 12, 0, 5));
    Account late = newDriver();
    offPeakTrips(late, 39);
    // Completed exactly Monday 19 Oct 00:00 local: next week.
    tripCompletedAt(late, local(2026, 10, 18, 23, 20), local(2026, 10, 19, 0, 0));
    CLOCK.set(EVALUATION);

    incentiveService.evaluatePreviousWeek(EVALUATION);

    assertThat(amountOf(early, "weekly_trips")).isEqualByComparingTo("50.00");
    assertThat(amountOf(late, "weekly_trips")).isNull();
  }

  @Test
  @DisplayName("rating reward: avg exactly 4.80 with 30 trips pays; 4.79 or 29 trips does not")
  void shouldPayTheRatingRewardOnTheThreshold() {
    Account exact = newDriver();
    Account below = newDriver();
    Account fewTrips = newDriver();
    rateTrips(exact, 30, 4, 1); // 4×5 + 1×4 = 4.80
    rateTrips(below, 30, 19, 5); // (95 + 20) / 24 = 4.7917
    rateTrips(fewTrips, 29, 5, 0); // 5.00 but 29 trips
    CLOCK.set(EVALUATION);

    incentiveService.evaluatePreviousWeek(EVALUATION);

    assertThat(amountOf(exact, "rating")).isEqualByComparingTo("20.00");
    assertThat(
            awards(exact).stream()
                .filter(row -> "rating".equals(row.get("kind")))
                .map(row -> (BigDecimal) row.get("avg_rating"))
                .findFirst())
        .hasValueSatisfying(avg -> assertThat(avg).isEqualByComparingTo("4.80"));
    assertThat(amountOf(below, "rating")).isNull();
    assertThat(amountOf(fewTrips, "rating")).isNull();
  }

  /**
   * {@code trips} off-peak trips; the first ones rated: {@code fives} × 5 then {@code fours} × 4.
   */
  private void rateTrips(Account driver, int trips, int fives, int fours) {
    Instant start = local(2026, 10, 14, 12, 0);
    for (int i = 0; i < trips; i++) {
      UUID rideId = trip(driver, start.plusSeconds(60L * i));
      int score = i < fives ? 5 : i < fives + fours ? 4 : 0;
      if (score > 0) {
        fixtureRating(rideId, rider.userId(), "rider", driver.userId(), "driver", score);
      }
    }
  }

  @Test
  @DisplayName("live progress matches what the job then pays")
  void shouldShowProgressThatMatchesThePayout() {
    Account driver = newDriver();
    offPeakTrips(driver, 38);
    trip(driver, local(2026, 10, 13, 8, 0)); // Tue peak
    trip(driver, local(2026, 10, 16, 23, 0)); // Fri overnight peak
    CLOCK.set(local(2026, 10, 18, 23, 50));

    JsonNode progress =
        ok(get("/api/v1/driver/incentives?regionId=" + regionId, driver.token()), HttpStatus.OK);
    assertThat(progress.get("configured").asBoolean()).isTrue();
    assertThat(progress.get("weekStart").asText()).isEqualTo("2026-10-12");
    assertThat(progress.get("weekEnd").asText()).isEqualTo("2026-10-18");
    JsonNode weekly = progress.get("weeklyTrips");
    assertThat(weekly.get("trips").asInt()).isEqualTo(40);
    assertThat(weekly.get("tiers").get(0).get("trips").asInt()).isEqualTo(40);
    assertThat(weekly.get("reachedTier").get("amount").decimalValue()).isEqualByComparingTo("50");
    assertThat(weekly.get("nextTier").get("trips").asInt()).isEqualTo(60);
    JsonNode peak = progress.get("peak");
    assertThat(peak.get("trips").asInt()).isEqualTo(2);
    assertThat(peak.get("earned").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(peak.get("windows")).hasSize(2);
    assertThat(peak.get("activeNow").asBoolean()).isFalse();
    assertThat(progress.get("rating").get("qualifies").asBoolean()).isFalse();

    CLOCK.set(EVALUATION);
    incentiveService.evaluatePreviousWeek(EVALUATION);
    assertThat(amountOf(driver, "weekly_trips")).isEqualByComparingTo("50.00");
    assertThat(amountOf(driver, "peak_hours")).isEqualByComparingTo("2.00");
    assertThat(amountOf(driver, "rating")).isNull();

    // The new week: nothing yet, a peak window open now, last week's awards listed.
    CLOCK.set(local(2026, 10, 20, 8, 0));
    JsonNode next =
        ok(get("/api/v1/driver/incentives?regionId=" + regionId, driver.token()), HttpStatus.OK);
    assertThat(next.get("weeklyTrips").get("trips").asInt()).isZero();
    assertThat(next.get("weeklyTrips").get("reachedTier").isNull()).isTrue();
    assertThat(next.get("peak").get("activeNow").asBoolean()).isTrue();
    assertThat(next.get("peak").get("activeUntil").asText()).isEqualTo("09:30:00");
    assertThat(next.get("recentAwards")).hasSize(2);
    assertThat(next.get("recentAwards").get(0).get("weekStart").asText()).isEqualTo("2026-10-12");
  }

  @Test
  @DisplayName("no incentive values: nothing paid, progress unconfigured; riders get 403")
  void shouldHandleUnconfiguredRegionsAndNonDrivers() {
    jdbcTemplate.update("UPDATE regions SET incentive_values = NULL WHERE region_id = ?", regionId);
    Account driver = newDriver();
    offPeakTrips(driver, 45);
    CLOCK.set(EVALUATION);

    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isZero();
    JsonNode progress =
        ok(get("/api/v1/driver/incentives?regionId=" + regionId, driver.token()), HttpStatus.OK);
    assertThat(progress.get("configured").asBoolean()).isFalse();
    assertThat(progress.get("weeklyTrips").isNull()).isTrue();
    assertThat(get("/api/v1/driver/incentives?regionId=" + regionId, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }
}
