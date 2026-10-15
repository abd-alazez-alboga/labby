package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.RideParty;
import com.labby.backend.service.TrustRules;
import com.labby.backend.service.TrustRules.MetricRule;
import com.labby.backend.service.TrustRules.RatingRule;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * M11 pure trust rules (trust-v1.yaml): region rating rules with SRS defaults and the derived
 * RATE-03 warning level, DRV-07 thresholds, the strict comparisons with minimum counts / samples,
 * and the DRV-06 percentage arithmetic.
 */
class TrustRulesTest {

  @Test
  @DisplayName("no region thresholds -> SRS defaults; warning level = suspension level + 0.5")
  void shouldDefaultTheRatingRules() {
    RatingRule driver = TrustRules.ratingRule(null, RideParty.DRIVER);
    assertThat(driver.minAvgRating()).isEqualByComparingTo("3.0");
    assertThat(driver.minRatedRides()).isEqualTo(20);
    assertThat(driver.warnAvgRating()).isEqualByComparingTo("3.5");
    RatingRule rider = TrustRules.ratingRule(Map.of(), RideParty.RIDER);
    assertThat(rider.minAvgRating()).isEqualByComparingTo("2.5");
    assertThat(rider.minRatedRides()).isEqualTo(10);
    assertThat(rider.warnAvgRating()).isEqualByComparingTo("3.0");
  }

  @Test
  @DisplayName("the region's rule wins; an absent warnAvgRating derives from its own minimum")
  void shouldReadTheRegionRule() {
    Map<String, Object> thresholds =
        Map.of(
            "driver", Map.of("minAvgRating", 3.2, "minRatedRides", 15, "warnAvgRating", 4.0),
            "rider", Map.of("minAvgRating", 2.0, "minRatedRides", 5));
    RatingRule driver = TrustRules.ratingRule(thresholds, RideParty.DRIVER);
    assertThat(driver.minAvgRating()).isEqualByComparingTo("3.2");
    assertThat(driver.minRatedRides()).isEqualTo(15);
    assertThat(driver.warnAvgRating()).isEqualByComparingTo("4.0");
    RatingRule rider = TrustRules.ratingRule(thresholds, RideParty.RIDER);
    assertThat(rider.warnAvgRating()).isEqualByComparingTo("2.5");
  }

  @Test
  @DisplayName("below = enough ratings AND a strictly lower average")
  void shouldCompareStrictlyWithTheMinimumCount() {
    BigDecimal level = new BigDecimal("3.0");
    assertThat(TrustRules.below(new BigDecimal("2.99"), 20, level, 20)).isTrue();
    assertThat(TrustRules.below(new BigDecimal("3.00"), 20, level, 20)).isFalse();
    assertThat(TrustRules.below(new BigDecimal("1.00"), 19, level, 20)).isFalse();
    assertThat(TrustRules.below(null, 0, level, 1)).isFalse();
  }

  @Test
  @DisplayName("DRV-07: defaults 50 / 15 / 30 / 20; strict thresholds; minimum sample")
  void shouldEvaluateMetricWarnings() {
    MetricRule defaults = TrustRules.metricRule(null);
    assertThat(defaults.minAcceptancePercent()).isEqualByComparingTo("50");
    assertThat(defaults.maxCancellationPercent()).isEqualByComparingTo("15");
    assertThat(defaults.windowDays()).isEqualTo(30);
    assertThat(defaults.minSample()).isEqualTo(20);
    assertThat(TrustRules.acceptanceBreached(9, 20, defaults)).isTrue();
    assertThat(TrustRules.acceptanceBreached(10, 20, defaults)).isFalse();
    assertThat(TrustRules.acceptanceBreached(0, 19, defaults)).isFalse();
    assertThat(TrustRules.cancellationBreached(3, 20, defaults)).isFalse();
    assertThat(TrustRules.cancellationBreached(4, 21, defaults)).isTrue();
    assertThat(TrustRules.cancellationBreached(19, 19, defaults)).isFalse();
    MetricRule region =
        TrustRules.metricRule(
            Map.of(
                "minAcceptancePercent", 60,
                "maxCancellationPercent", 10,
                "windowDays", 7,
                "minSample", 5));
    assertThat(region).isEqualTo(new MetricRule(new BigDecimal("60"), new BigDecimal("10"), 7, 5));
  }

  @Test
  @DisplayName("DRV-06 percentages: 1 decimal half up, null for an empty base")
  void shouldComputePercentages() {
    assertThat(TrustRules.percent(2, 3)).isEqualByComparingTo("66.7");
    assertThat(TrustRules.percent(1, 8)).isEqualByComparingTo("12.5");
    assertThat(TrustRules.percent(0, 4)).isEqualByComparingTo("0.0");
    assertThat(TrustRules.percent(0, 0)).isNull();
  }

  @Test
  @DisplayName("RATE-02: the exposed average only from 5 ratings on")
  void shouldExposeFromFiveRatings() {
    assertThat(TrustRules.exposed(new BigDecimal("4.20"), 4)).isNull();
    assertThat(TrustRules.exposed(new BigDecimal("4.20"), 5)).isEqualByComparingTo("4.20");
  }
}
