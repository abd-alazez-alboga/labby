package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * M11-T2 driver performance (DRV-06/07, UC-D-20) on a controlled clock: the metric formulas of the
 * contract table against hand-built offer/ride fixtures for both rolling windows, earnings from the
 * driver ledger, the lifetime snapshot rating with the region's rule; DRV-07 warnings raised on a
 * breach with enough sample (push + flag, NEVER a suspension), not below the minimum sample, not at
 * the exact threshold, cleared on recovery, with the region's own thresholds.
 */
class TrustPerformanceIntegrationTest extends AbstractTrustIntegrationTest {

  private static final int ETA = 300;

  @Test
  @DisplayName("DRV-06: acceptance, cancellation, on-time and trips per window match the formulas")
  void shouldComputeTheMetricFormulas() {
    Account driver = newDriver();
    Account rider = newRider();
    Instant now = CLOCK.instant();
    // 7-day window.
    acceptedRide(rider, driver, "completed", now.minus(Duration.ofDays(2)), ETA + 300); // on time
    acceptedRide(rider, driver, "completed", now.minus(Duration.ofDays(3)), ETA + 301); // late
    acceptedRide(rider, driver, "cancelled_by_driver", now.minus(Duration.ofDays(1)), null);
    acceptedRide(rider, driver, "cancelled_by_rider", now.minus(Duration.ofDays(1)), 100);
    unacceptedOffer(rider, driver, now.minus(Duration.ofDays(1)), "declined");
    unacceptedOffer(rider, driver, now.minus(Duration.ofDays(1)), "timeout");
    unacceptedOffer(rider, driver, now.minus(Duration.ofDays(1)), "withdrawn"); // never counted
    Account waiting = newRider();
    UUID open = ride(waiting.userId(), null, "offering", null, null, null, null);
    offer(open, driver.userId(), now.minusSeconds(5), null, ETA); // still open: not counted
    // 8..30 days.
    acceptedRide(rider, driver, "completed", now.minus(Duration.ofDays(10)), 60);
    unacceptedOffer(rider, driver, now.minus(Duration.ofDays(12)), "declined");
    // Older than 30 days: outside both windows.
    acceptedRide(rider, driver, "cancelled_by_driver", now.minus(Duration.ofDays(40)), null);

    JsonNode dashboard = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    JsonNode week = dashboard.get("windows").get(0);
    assertThat(week.get("days").asInt()).isEqualTo(7);
    assertPercentage(week.get("acceptance"), 4, 6, "66.7");
    assertPercentage(week.get("cancellation"), 1, 4, "25.0");
    assertPercentage(week.get("onTime"), 2, 3, "66.7");
    assertThat(week.get("trips").asInt()).isEqualTo(2);
    assertThat(week.get("earnings")).isEmpty();
    JsonNode month = dashboard.get("windows").get(1);
    assertThat(month.get("days").asInt()).isEqualTo(30);
    assertPercentage(month.get("acceptance"), 5, 8, "62.5");
    assertPercentage(month.get("cancellation"), 1, 5, "20.0");
    assertPercentage(month.get("onTime"), 3, 4, "75.0");
    assertThat(month.get("trips").asInt()).isEqualTo(3);
    assertThat(dashboard.get("warnings")).isEmpty();

    // An empty window has null percentages, never a division by zero.
    Account fresh = newDriver();
    JsonNode empty =
        ok(get("/api/v1/driver/performance", fresh.token()), HttpStatus.OK).get("windows").get(0);
    assertThat(empty.get("acceptance").get("percent").isNull()).isTrue();
    assertThat(empty.get("acceptance").get("denominator").asInt()).isZero();
    // Not an approved driver.
    assertThat(get("/api/v1/driver/performance", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("DRV-06: a real ride counts as a trip with its ledger fare earnings")
  void shouldReportTripsAndEarningsFromTheLedger() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    completeRide(rider, driver, "cash");
    JsonNode week =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("windows").get(0);
    assertThat(week.get("trips").asInt()).isEqualTo(1);
    assertPercentage(week.get("acceptance"), 1, 1, "100.0");
    assertPercentage(week.get("cancellation"), 0, 1, "0.0");
    assertPercentage(week.get("onTime"), 1, 1, "100.0");
    assertThat(week.get("earnings")).hasSize(1);
    assertThat(week.get("earnings").get(0).get("currency").asText()).isEqualTo("SYP");
    // The driver's share: fare 1.50 minus the 0.38 commission.
    assertThat(week.get("earnings").get(0).get("amount").decimalValue())
        .isEqualByComparingTo(FARE.subtract(COMMISSION));
  }

  @Test
  @DisplayName(
      "UC-D-20 A1: the lifetime snapshot rating with the region's rule; the proximity warning"
          + " under warnAvgRating")
  void shouldShowTheSnapshotRatingAndRule() {
    Account driver = newDriver();
    Account rider = newRider();
    JsonNode none = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(none.get("ratingRule").isNull()).isTrue(); // no ride yet: no region
    assertThat(none.get("ratingWarning").asBoolean()).isFalse();
    assertThat(none.get("rating").get("average").isNull()).isTrue();

    driverRatedTimes(rider, driver, 3, 3);
    driverRatedTimes(rider, driver, 2, 4); // 17 / 5 = 3.40
    JsonNode before = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(before.get("rating").get("average").isNull()).isTrue(); // no snapshot yet
    assertThat(before.get("ratingWarning").asBoolean()).isFalse();
    ratingService.refreshSnapshots();
    JsonNode after = ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK);
    assertThat(after.get("rating").get("average").decimalValue()).isEqualByComparingTo("3.40");
    assertThat(after.get("rating").has("ratingCount")).isFalse();
    JsonNode rule = after.get("ratingRule");
    assertThat(rule.get("minAvgRating").decimalValue()).isEqualByComparingTo("3.0");
    assertThat(rule.get("minRatedRides").asInt()).isEqualTo(20);
    assertThat(rule.get("warnAvgRating").decimalValue()).isEqualByComparingTo("3.5");
    assertThat(after.get("ratingWarning").asBoolean()).isTrue();
  }

  @Test
  @DisplayName(
      "DRV-07: acceptance below 50% over 30 days with 20 offers warns (push + flag, never a"
          + " suspension), once; recovery clears it; 19 offers never warn")
  void shouldWarnOnLowAcceptanceAndClearOnRecovery() {
    Account driver = newDriver();
    Account rider = newRider();
    Instant day = CLOCK.instant().minus(Duration.ofDays(1));
    for (int i = 0; i < 9; i++) {
      acceptedRide(rider, driver, "completed", day, 60);
    }
    for (int i = 0; i < 11; i++) {
      unacceptedOffer(rider, driver, day, "declined");
    }
    assertThat(driverPerformanceService.warningCandidates()).contains(driver.userId());
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isEqualTo(1);

    JsonNode warnings =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("warnings");
    assertThat(warnings).hasSize(1);
    JsonNode warning = warnings.get(0);
    assertThat(warning.get("metric").asText()).isEqualTo("acceptance");
    assertThat(warning.get("valuePercent").decimalValue()).isEqualByComparingTo("45");
    assertThat(warning.get("thresholdPercent").decimalValue()).isEqualByComparingTo("50");
    assertThat(warning.get("comparison").asText()).isEqualTo("below");
    assertThat(warning.get("windowDays").asInt()).isEqualTo(30);
    assertThat(warning.get("sampleSize").asInt()).isEqualTo(20);
    assertThat(outboxParams(driver.userId(), "driver.metric_warning"))
        .singleElement()
        .satisfies(
            params -> assertThat(params).contains("\"metric\": \"acceptance\"", "\"45.00\""));
    assertThat(flags(driver.userId()))
        .singleElement()
        .satisfies(
            flag -> {
              assertThat(flag.get("kind")).isEqualTo("metric_warning");
              assertThat((String) flag.get("details"))
                  .contains("\"sampleSize\": 20", "\"windowDays\": 30");
            });
    // Warn only: no suspension of any kind.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(outboxParams(driver.userId(), "account.role_suspended")).isEmpty();
    // Re-evaluating while the breach holds raises nothing new.
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isZero();
    assertThat(outboxParams(driver.userId(), "driver.metric_warning")).hasSize(1);
    assertThat(flags(driver.userId())).hasSize(1);
    // The admin trust profile shows the active warning.
    JsonNode trust =
        ok(get("/api/v1/admin/users/" + driver.userId() + "/trust", admin), HttpStatus.OK);
    assertThat(TrustRatingsIntegrationTest.roleTrust(trust, "driver").get("activeWarnings"))
        .hasSize(1);

    // 11 / 22 = 50%: not below 50 -> recovered, the warning clears itself.
    acceptedRide(rider, driver, "completed", day, 60);
    acceptedRide(rider, driver, "completed", day, 60);
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isZero();
    assertThat(ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("warnings"))
        .isEmpty();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cleared_at IS NOT NULL FROM driver_metric_warnings WHERE driver_user_id = ?",
                Boolean.class,
                driver.userId()))
        .isTrue();

    // Minimum sample: 19 decided offers at 0% never warn.
    Account quiet = newDriver();
    for (int i = 0; i < 19; i++) {
      unacceptedOffer(rider, quiet, day, "declined");
    }
    assertThat(driverPerformanceService.evaluateWarnings(quiet.userId())).isZero();
    assertThat(flags(quiet.userId())).isEmpty();
  }

  @Test
  @DisplayName("DRV-07: cancellation exactly 15% does not warn; above 15% over 20+ rides does")
  void shouldWarnOnHighCancellationStrictlyAboveTheThreshold() {
    Account driver = newDriver();
    Account rider = newRider();
    Instant day = CLOCK.instant().minus(Duration.ofDays(2));
    for (int i = 0; i < 17; i++) {
      acceptedRide(rider, driver, "completed", day, 60);
    }
    for (int i = 0; i < 3; i++) {
      acceptedRide(rider, driver, "cancelled_by_driver", day, null);
    }
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isZero(); // 3/20 = 15%
    acceptedRide(rider, driver, "cancelled_by_driver", day, null);
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isEqualTo(1);
    JsonNode warning =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("warnings").get(0);
    assertThat(warning.get("metric").asText()).isEqualTo("cancellation");
    assertThat(warning.get("comparison").asText()).isEqualTo("above");
    assertThat(warning.get("valuePercent").decimalValue()).isEqualByComparingTo("19.05");
    assertThat(warning.get("sampleSize").asInt()).isEqualTo(21);
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
  }

  @Test
  @DisplayName(
      "DRV-06/07 (review B-W6): a rider_no_show cancellation counts in neither the cancellations"
          + " nor their base")
  void shouldExcludeNoShowsFromTheCancellationRate() {
    Account driver = newDriver();
    Account rider = newRider();
    Instant day = CLOCK.instant().minus(Duration.ofDays(1));
    acceptedRide(rider, driver, "completed", day, 60);
    acceptedRide(rider, driver, "cancelled_by_driver", day, null);
    acceptedRide(rider, driver, "cancelled_by_driver", day, 60);
    jdbcTemplate.update(
        "UPDATE rides SET cancellation_reason = 'rider_no_show' WHERE driver_user_id = ?"
            + " AND state = 'cancelled_by_driver' AND driver_arrived_at IS NOT NULL",
        driver.userId());
    JsonNode week =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("windows").get(0);
    assertPercentage(week.get("cancellation"), 1, 2, "50.0");
    // The no-show still counts where the contract counts it: an accepted offer, an arrival.
    assertPercentage(week.get("acceptance"), 3, 3, "100.0");
    assertPercentage(week.get("onTime"), 2, 2, "100.0");
  }

  @Test
  @DisplayName("DRV-07 per region: the region's thresholds, window and minimum sample apply")
  void shouldApplyTheRegionsMetricWarnings() {
    jdbcTemplate.update(
        "UPDATE regions SET metric_warnings = CAST(? AS jsonb) WHERE region_id = ?",
        "{\"minAcceptancePercent\": 60, \"maxCancellationPercent\": 50, \"windowDays\": 7,"
            + " \"minSample\": 5}",
        regionId);
    Account driver = newDriver();
    Account rider = newRider();
    Instant day = CLOCK.instant().minus(Duration.ofDays(1));
    acceptedRide(rider, driver, "completed", day, 60);
    acceptedRide(rider, driver, "completed", day, 60);
    // Outside the region's 7-day window: ignored.
    acceptedRide(rider, driver, "completed", CLOCK.instant().minus(Duration.ofDays(9)), 60);
    for (int i = 0; i < 3; i++) {
      unacceptedOffer(rider, driver, day, "declined");
    }
    // 2 / 5 = 40% < 60% with the 5-offer minimum sample.
    assertThat(driverPerformanceService.evaluateWarnings(driver.userId())).isEqualTo(1);
    JsonNode warning =
        ok(get("/api/v1/driver/performance", driver.token()), HttpStatus.OK).get("warnings").get(0);
    assertThat(warning.get("thresholdPercent").decimalValue()).isEqualByComparingTo("60");
    assertThat(warning.get("windowDays").asInt()).isEqualTo(7);
    assertThat(warning.get("sampleSize").asInt()).isEqualTo(5);
  }

  /**
   * A ride the driver accepted at {@code acceptedAt} through an accepted offer quoting {@link
   * #ETA}; arrived {@code arriveAfterSeconds} after acceptance (null = never arrived).
   */
  private void acceptedRide(
      Account rider, Account driver, String state, Instant acceptedAt, Integer arriveAfterSeconds) {
    Instant arrivedAt =
        arriveAfterSeconds == null ? null : acceptedAt.plusSeconds(arriveAfterSeconds);
    boolean completed = "completed".equals(state);
    UUID rideId =
        ride(
            rider.userId(),
            driver.userId(),
            state,
            acceptedAt,
            arrivedAt,
            completed ? acceptedAt.plusSeconds(1800) : null,
            completed ? null : acceptedAt.plusSeconds(arrivedAt == null ? 60 : 900));
    offer(rideId, driver.userId(), acceptedAt.minusSeconds(10), "accepted", ETA);
  }

  /** An offer the driver did not accept, on a ride that found no driver. */
  private void unacceptedOffer(Account rider, Account driver, Instant offeredAt, String response) {
    UUID rideId = ride(rider.userId(), null, "no_driver_found", null, null, null, null);
    offer(rideId, driver.userId(), offeredAt, response, ETA);
  }

  private static void assertPercentage(
      JsonNode percentage, int numerator, int denominator, String percent) {
    assertThat(percentage.get("numerator").asInt()).isEqualTo(numerator);
    assertThat(percentage.get("denominator").asInt()).isEqualTo(denominator);
    assertThat(percentage.get("percent").decimalValue()).isEqualByComparingTo(percent);
  }
}
