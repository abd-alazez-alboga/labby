package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.IncentiveJob;
import com.labby.backend.service.IncentiveService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
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
 * The job ticks hourly (review W1): each tick pays every region's last finished week in its zone.
 */
class IncentiveIntegrationTest extends AbstractTrustIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");
  private static final Instant EVALUATION = local(2026, 10, 19, 0, 30);

  @Autowired private IncentiveService incentiveService;
  @Autowired private IncentiveJob incentiveJob;

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

  @Test
  @DisplayName("one evaluation per week: late ratings and later config edits change nothing")
  void shouldEvaluateAWeekOnlyInsideItsWindow() {
    Account lateRated = newDriver();
    rateTrips(lateRated, 30, 4, 1); // 4.80 counting only in-week ratings
    // A 1 left on Monday for a Sunday trip would pull the average to 4.17 — it must not count.
    UUID sundayTrip = trip(lateRated, local(2026, 10, 18, 20, 0));
    CLOCK.set(local(2026, 10, 19, 10, 0));
    fixtureRating(sundayTrip, rider.userId(), "rider", lateRated.userId(), "driver", 1);
    Account belowTier = newDriver();
    offPeakTrips(belowTier, 35);
    CLOCK.set(EVALUATION);

    incentiveService.evaluatePreviousWeek(EVALUATION);
    assertThat(amountOf(lateRated, "rating")).isEqualByComparingTo("20.00");
    assertThat(amountOf(belowTier, "weekly_trips")).isNull();

    // Wednesday: an admin lowers the first tier to 30 trips; last week is closed (24 h window).
    jdbcTemplate.update(
        "UPDATE regions SET incentive_values = jsonb_set(incentive_values,"
            + " '{weeklyTripBonuses,1,trips}', '30') WHERE region_id = ?",
        regionId);
    Instant wednesday = local(2026, 10, 21, 10, 0);
    CLOCK.set(wednesday);
    assertThat(incentiveService.evaluatePreviousWeek(wednesday)).isZero();
    assertThat(amountOf(belowTier, "weekly_trips")).isNull();
    // Inside the window (Monday 23:00) a tick still runs with the current config: the 31- and
    // 35-trip drivers now reach the lowered tier — the window bounds how late an edit can apply.
    assertThat(incentiveService.evaluatePreviousWeek(local(2026, 10, 19, 23, 0))).isEqualTo(2);
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
        // Rated as the trip completes, inside the week (only those count — re-audit N1).
        CLOCK.set(start.plusSeconds(60L * i + 1800));
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
  @DisplayName(
      "H5: the rating block shows the nightly average only — a stored rating never moves it, no"
          + " count is exposed")
  void shouldShowOnlyTheNightlyRatingAverage() {
    Account driver = newDriver();
    Instant start = local(2026, 10, 14, 12, 0);
    List<UUID> trips = new ArrayList<>();
    for (int i = 0; i < 30; i++) {
      trips.add(trip(driver, start.plusSeconds(60L * i)));
    }
    CLOCK.set(local(2026, 10, 14, 20, 0));
    for (int i = 0; i < 4; i++) {
      fixtureRating(trips.get(i), rider.userId(), "rider", driver.userId(), "driver", 5);
    }
    JsonNode rating = ratingBlock(driver);
    assertThat(rating.has("ratingCount")).isFalse();
    assertThat(rating.get("average").isNull()).isTrue();
    assertThat(rating.get("averageAsOf").isNull()).isTrue();
    assertThat(rating.get("minAvgRating").decimalValue()).isEqualByComparingTo("4.8");
    assertThat(rating.get("trips").asInt()).isEqualTo(30);
    assertThat(rating.get("qualifies").asBoolean()).isFalse();

    // Night 1: four ratings are below the RATE-02 exposure minimum (5) — still no average.
    CLOCK.set(local(2026, 10, 15, 0, 20));
    ratingSnapshotJob.run();
    assertThat(ratingBlock(driver).get("average").isNull()).isTrue();

    // A fifth rating (4★) is stored: nothing moves until the next night.
    CLOCK.set(local(2026, 10, 15, 9, 0));
    fixtureRating(trips.get(4), rider.userId(), "rider", driver.userId(), "driver", 4);
    assertThat(ratingBlock(driver).get("average").isNull()).isTrue();
    Instant night2 = local(2026, 10, 16, 0, 20);
    CLOCK.set(night2);
    ratingSnapshotJob.run();
    rating = ratingBlock(driver);
    assertThat(rating.get("average").decimalValue()).isEqualByComparingTo("4.80");
    assertThat(Instant.parse(rating.get("averageAsOf").asText())).isEqualTo(night2);
    assertThat(rating.get("qualifies").asBoolean()).isTrue();
    assertThat(rating.has("ratingCount")).isFalse();

    // A 1★ the next morning: the screen and the qualification stay as of last night...
    CLOCK.set(local(2026, 10, 16, 10, 0));
    fixtureRating(trips.get(5), rider.userId(), "rider", driver.userId(), "driver", 1);
    rating = ratingBlock(driver);
    assertThat(rating.get("average").decimalValue()).isEqualByComparingTo("4.80");
    assertThat(rating.get("qualifies").asBoolean()).isTrue();
    // ...and one new rating is below the rewrite minimum (3): the next night keeps it too.
    CLOCK.set(local(2026, 10, 17, 0, 20));
    ratingSnapshotJob.run();
    rating = ratingBlock(driver);
    assertThat(rating.get("average").decimalValue()).isEqualByComparingTo("4.80");
    assertThat(Instant.parse(rating.get("averageAsOf").asText())).isEqualTo(night2);

    // Three new ratings since the stored snapshot: the night rewrites it (27 / 8 = 3.375 → 3.37).
    CLOCK.set(local(2026, 10, 17, 10, 0));
    fixtureRating(trips.get(6), rider.userId(), "rider", driver.userId(), "driver", 1);
    fixtureRating(trips.get(7), rider.userId(), "rider", driver.userId(), "driver", 1);
    Instant night4 = local(2026, 10, 18, 0, 20);
    CLOCK.set(night4);
    ratingSnapshotJob.run();
    rating = ratingBlock(driver);
    assertThat(rating.get("average").decimalValue()).isEqualByComparingTo("3.37");
    assertThat(Instant.parse(rating.get("averageAsOf").asText())).isEqualTo(night4);
    assertThat(rating.get("qualifies").asBoolean()).isFalse();
  }

  private JsonNode ratingBlock(Account driver) {
    return ok(get("/api/v1/driver/incentives?regionId=" + regionId, driver.token()), HttpStatus.OK)
        .get("rating");
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

  @Test
  @DisplayName(
      "W1: each region is paid its own finished week, a zone behind Damascus an hour later")
  void shouldPayEachRegionItsOwnFinishedWeek() {
    Account damascus = newDriver();
    offPeakTrips(damascus, 40); // Tue 14 Oct: week of Mon 12 Oct (Damascus)
    Account older = newDriver();
    Instant weekBeforeLast = local(2026, 10, 7, 12, 0); // Wed 7 Oct: week of Mon 5 Oct
    for (int i = 0; i < 40; i++) {
      trip(older, weekBeforeLast.plusSeconds(60L * i));
    }
    UUID utcRegion =
        region(
            "UTC",
            """
            {"weeklyTripBonuses":[{"trips":1,"amount":10}],"peakHourBonusPerTrip":0,
             "ratingReward":{"amount":0,"minAvgRating":4.8,"minWeeklyTrips":30}}
            """);
    Account western = newDriver();
    // Completed Sun 18 Oct 21:30 UTC = Mon 19 Oct 00:30 Damascus: still the week of Mon 12 Oct in
    // the UTC region's own zone.
    Instant sundayNightUtc = LocalDateTime.of(2026, 10, 18, 21, 0).toInstant(ZoneOffset.UTC);
    UUID westernTrip = tripCompletedAt(western, sundayNightUtc, sundayNightUtc.plusSeconds(1800));
    jdbcTemplate.update("UPDATE rides SET region_id = ? WHERE ride_id = ?", utcRegion, westernTrip);

    // Tick 1: Mon 19 Oct 01:00 Damascus = Sun 18 Oct 22:00 UTC — the UTC week is not over.
    CLOCK.set(local(2026, 10, 19, 1, 0));
    incentiveJob.run();
    assertThat(amountOf(damascus, "weekly_trips")).isEqualByComparingTo("50.00");
    assertThat(awards(western)).isEmpty();

    // Tick 2: Mon 19 Oct 00:30 UTC (03:30 Damascus) — the UTC week is over: paid now.
    CLOCK.set(LocalDateTime.of(2026, 10, 19, 0, 30).toInstant(ZoneOffset.UTC));
    incentiveJob.run();
    assertThat(amountOf(western, "weekly_trips")).isEqualByComparingTo("10.00");
    assertThat(awards(damascus)).hasSize(1); // not paid twice

    // Only the finished week was paid in both regions, never the week before last.
    assertThat(awards(older)).isEmpty();
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT DISTINCT week_start::text FROM incentive_awards", String.class))
        .containsExactly("2026-10-12");
  }

  @Test
  @DisplayName("W1: a failing award or region is skipped and logged; the rest of the run pays")
  void shouldKeepPayingPastAFailure() {
    Account failing = newDriver();
    offPeakTrips(failing, 40);
    trip(failing, local(2026, 10, 13, 8, 0)); // Tue peak: a second award after the failing one
    Account other = newDriver();
    offPeakTrips(other, 40);
    // A region whose zone no longer parses: its evaluation throws.
    region(
        "Not/AZone",
        "{\"weeklyTripBonuses\":[],\"peakHourBonusPerTrip\":0,"
            + "\"ratingReward\":{\"amount\":0,\"minAvgRating\":4.8,\"minWeeklyTrips\":30}}");
    // The weekly award of one driver fails with a non-key integrity error (test-only trigger).
    jdbcTemplate.execute(
        ("CREATE FUNCTION test_fail_award() RETURNS trigger AS $$ BEGIN"
                + " IF NEW.driver_user_id = '%s' AND NEW.kind = 'weekly_trips' THEN"
                + " RAISE EXCEPTION 'test award failure' USING ERRCODE = 'check_violation';"
                + " END IF; RETURN NEW; END $$ LANGUAGE plpgsql")
            .formatted(failing.userId()));
    jdbcTemplate.execute(
        "CREATE TRIGGER test_fail_award BEFORE INSERT ON incentive_awards"
            + " FOR EACH ROW EXECUTE FUNCTION test_fail_award()");
    CLOCK.set(EVALUATION);
    try {
      assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isEqualTo(2);
    } finally {
      jdbcTemplate.execute("DROP TRIGGER IF EXISTS test_fail_award ON incentive_awards");
      jdbcTemplate.execute("DROP FUNCTION IF EXISTS test_fail_award()");
    }

    assertThat(amountOf(failing, "weekly_trips")).isNull(); // rolled back with its ledger entry
    assertThat(amountOf(failing, "peak_hours")).isEqualByComparingTo("1.00");
    assertThat(driverLedger(failing.userId())).hasSize(1);
    assertThat(amountOf(other, "weekly_trips")).isEqualByComparingTo("50.00");

    // The next tick retries what failed.
    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION.plusSeconds(3600))).isEqualTo(1);
    assertThat(amountOf(failing, "weekly_trips")).isEqualByComparingTo("50.00");
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("I3: an amount that rounds to 0.00 is skipped, not posted")
  void shouldSkipAmountsRoundingToZero() {
    jdbcTemplate.update(
        "UPDATE regions SET incentive_values = jsonb_set(incentive_values,"
            + " '{peakHourBonusPerTrip}', '0.004') WHERE region_id = ?",
        regionId);
    Account driver = newDriver();
    offPeakTrips(driver, 40);
    trip(driver, local(2026, 10, 13, 8, 0)); // 1 peak trip × 0.004 = 0.004 → 0.00
    CLOCK.set(EVALUATION);

    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isEqualTo(1);

    assertThat(amountOf(driver, "weekly_trips")).isEqualByComparingTo("50.00");
    assertThat(amountOf(driver, "peak_hours")).isNull();
    assertThat(driverLedger(driver.userId())).hasSize(1);
  }

  @Test
  @DisplayName("W2: a scheduled ride counts as peak at its pickup time, not its booking time")
  void shouldCountScheduledRidesAtTheirPickupTime() {
    Account peakPickup = newDriver();
    // Booked Tue 14 Oct 12:00 (off-peak) for a Thu 15 Oct 08:00 pickup (Mon–Thu window): peak.
    scheduledTrip(peakPickup, local(2026, 10, 14, 12, 0), local(2026, 10, 15, 8, 0));
    Account peakBooking = newDriver();
    // Booked Mon 12 Oct 08:00 (inside a window) for a Wed 14 Oct 13:00 pickup: not peak.
    scheduledTrip(peakBooking, local(2026, 10, 12, 8, 0), local(2026, 10, 14, 13, 0));
    CLOCK.set(EVALUATION);

    incentiveService.evaluatePreviousWeek(EVALUATION);

    assertThat(amountOf(peakPickup, "peak_hours")).isEqualByComparingTo("1.00");
    assertThat(awards(peakPickup).get(0).get("trips")).isEqualTo(1);
    assertThat(awards(peakBooking)).isEmpty();
  }

  @Test
  @DisplayName("Q5: a driver suspended at evaluation time is still paid for the week")
  void shouldPaySuspendedDrivers() {
    Account roleSuspended = newDriver();
    offPeakTrips(roleSuspended, 40);
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'low_rating'"
            + " WHERE user_id = ? AND role = 'driver'",
        roleSuspended.userId());
    Account accountSuspended = newDriver();
    offPeakTrips(accountSuspended, 40);
    jdbcTemplate.update(
        "UPDATE users SET state = 'suspended' WHERE user_id = ?", accountSuspended.userId());
    CLOCK.set(EVALUATION);

    assertThat(incentiveService.evaluatePreviousWeek(EVALUATION)).isEqualTo(2);

    assertThat(amountOf(roleSuspended, "weekly_trips")).isEqualByComparingTo("50.00");
    assertThat(amountOf(accountSuspended, "weekly_trips")).isEqualByComparingTo("50.00");
  }

  /** An active region in {@code zone} with these incentive values (Aleppo-like boundary). */
  private UUID region(String zone, String incentiveValues) {
    return jdbcTemplate.queryForObject(
        "INSERT INTO regions (name, state, currency, emergency_number, time_zone, incentive_values,"
            + " boundary) VALUES (?, 'active', 'SYP', '112', ?, ?::jsonb,"
            + " ST_GeomFromText('POLYGON((37.0 36.0, 37.3 36.0, 37.3 36.3, 37.0 36.3, 37.0 36.0))',"
            + " 4326)) RETURNING region_id",
        UUID.class,
        "Incentive " + zone,
        zone,
        incentiveValues);
  }

  /**
   * A claimed scheduled ride booked at {@code bookedAt}, converted and completed 40 min after its
   * {@code pickupAt} — {@code requested_at} keeps the booking moment, as for a claimed ride.
   */
  private void scheduledTrip(Account driver, Instant bookedAt, Instant pickupAt) {
    UUID rideId = tripCompletedAt(driver, pickupAt, pickupAt.plusSeconds(2400));
    jdbcTemplate.update(
        "UPDATE rides SET kind = 'scheduled', requested_at = ? WHERE ride_id = ?",
        ts(bookedAt),
        rideId);
    jdbcTemplate.update(
        "INSERT INTO scheduled_rides (ride_id, scheduled_at, claimed_driver_user_id,"
            + " claimed_vehicle_id, claimed_at, converted_at) VALUES (?, ?, ?, ?, ?, ?)",
        rideId,
        ts(pickupAt),
        driver.userId(),
        vehicleOf(driver.userId()),
        ts(bookedAt.plusSeconds(600)),
        ts(pickupAt.minusSeconds(900)));
  }
}
