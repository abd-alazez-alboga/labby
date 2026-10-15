package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;

/**
 * The pure M11 trust rules (trust-v1.yaml): the per-region rating rule (USR-05 suspension + RATE-03
 * warning level) and DRV-07 metric thresholds with their SRS defaults, the strict comparisons, and
 * the percentage arithmetic of the driver metrics.
 */
public final class TrustRules {

  /** RATE-02: the exposed average is shown only from this many ratings on (owner ruling). */
  public static final int MIN_EXPOSED_RATINGS = 5;

  /** RATE-01: the rating window after completion. */
  public static final int RATING_WINDOW_DAYS = 7;

  /** RATE-03 default distance of the warning level above the suspension level (owner ruling). */
  static final BigDecimal DEFAULT_WARN_MARGIN = new BigDecimal("0.5");

  static final RatingRule DEFAULT_DRIVER_RULE = rule(new BigDecimal("3.0"), 20, null);
  static final RatingRule DEFAULT_RIDER_RULE = rule(new BigDecimal("2.5"), 10, null);

  /** DRV-07 SRS defaults: acceptance below 50 %, cancellation above 15 %, 30 days, sample 20. */
  static final MetricRule DEFAULT_METRIC_RULE =
      new MetricRule(new BigDecimal("50"), new BigDecimal("15"), 30, 20);

  private TrustRules() {}

  /**
   * One role's rating rule.
   *
   * @param minAvgRating USR-05: suspend below this live average
   * @param minRatedRides both rules need at least this many ratings
   * @param warnAvgRating RATE-03: flag below this live average
   */
  public record RatingRule(BigDecimal minAvgRating, int minRatedRides, BigDecimal warnAvgRating) {}

  /**
   * The DRV-07 thresholds of a region.
   *
   * @param minAcceptancePercent warn below this acceptance
   * @param maxCancellationPercent warn above this cancellation
   * @param windowDays the evaluation window
   * @param minSample the minimum offers (acceptance) / accepted rides (cancellation)
   */
  public record MetricRule(
      BigDecimal minAcceptancePercent,
      BigDecimal maxCancellationPercent,
      int windowDays,
      int minSample) {}

  /**
   * The rating rule of a role from a region's {@code suspensionThresholds} JSON: the SRS defaults
   * (driver 3.0 / 20, rider 2.5 / 10) when the region has none; {@code warnAvgRating} absent =
   * {@code minAvgRating + 0.5}.
   *
   * @param suspensionThresholds the region's JSON (may be null)
   * @param role the rated role
   * @return the rule
   */
  public static RatingRule ratingRule(Map<String, Object> suspensionThresholds, RideParty role) {
    RatingRule fallback = role == RideParty.DRIVER ? DEFAULT_DRIVER_RULE : DEFAULT_RIDER_RULE;
    if (suspensionThresholds == null
        || !(suspensionThresholds.get(role.getValue()) instanceof Map<?, ?> threshold)) {
      return fallback;
    }
    BigDecimal min = decimal(threshold.get("minAvgRating"));
    Integer rides = integer(threshold.get("minRatedRides"));
    if (min == null || rides == null) {
      return fallback;
    }
    return rule(min, rides, decimal(threshold.get("warnAvgRating")));
  }

  /**
   * The DRV-07 rule from a region's {@code metricWarnings} JSON; null or incomplete = the defaults.
   *
   * @param metricWarnings the region's JSON (may be null)
   * @return the rule
   */
  public static MetricRule metricRule(Map<String, Object> metricWarnings) {
    if (metricWarnings == null) {
      return DEFAULT_METRIC_RULE;
    }
    BigDecimal acceptance = decimal(metricWarnings.get("minAcceptancePercent"));
    BigDecimal cancellation = decimal(metricWarnings.get("maxCancellationPercent"));
    Integer window = integer(metricWarnings.get("windowDays"));
    Integer sample = integer(metricWarnings.get("minSample"));
    if (acceptance == null || cancellation == null || window == null || sample == null) {
      return DEFAULT_METRIC_RULE;
    }
    return new MetricRule(acceptance, cancellation, window, sample);
  }

  /**
   * Whether a live aggregate is below a level: enough ratings AND a strictly lower average.
   *
   * @param average the live average (null without ratings)
   * @param count the rating count
   * @param level the level
   * @param minCount the minimum count
   * @return true when the rule fires
   */
  public static boolean below(BigDecimal average, long count, BigDecimal level, int minCount) {
    return average != null && count >= minCount && average.compareTo(level) < 0;
  }

  /**
   * A DRV-06 percentage with 1 decimal (half up), or null when the denominator is 0.
   *
   * @param numerator counted events
   * @param denominator the base
   * @return the percentage
   */
  public static BigDecimal percent(long numerator, long denominator) {
    if (denominator == 0) {
      return null;
    }
    return BigDecimal.valueOf(numerator)
        .multiply(BigDecimal.valueOf(100))
        .divide(BigDecimal.valueOf(denominator), 1, RoundingMode.HALF_UP);
  }

  /**
   * The exact percentage for threshold comparisons (no display rounding).
   *
   * @param numerator counted events
   * @param denominator the base (non-zero)
   * @return the percentage with 4 decimals
   */
  public static BigDecimal exactPercent(long numerator, long denominator) {
    return BigDecimal.valueOf(numerator)
        .multiply(BigDecimal.valueOf(100))
        .divide(BigDecimal.valueOf(denominator), 4, RoundingMode.HALF_UP);
  }

  /**
   * DRV-07 acceptance warning: a sample of at least {@code minSample} decided offers and an
   * acceptance strictly below the minimum.
   *
   * @param accepted accepted offers
   * @param decided decided offers
   * @param rule the region's rule
   * @return true when the warning applies
   */
  public static boolean acceptanceBreached(long accepted, long decided, MetricRule rule) {
    return decided >= rule.minSample()
        && exactPercent(accepted, decided).compareTo(rule.minAcceptancePercent()) < 0;
  }

  /**
   * DRV-07 cancellation warning: at least {@code minSample} accepted rides and a cancellation rate
   * strictly above the maximum.
   *
   * @param cancelled rides cancelled by the driver
   * @param accepted rides accepted
   * @param rule the region's rule
   * @return true when the warning applies
   */
  public static boolean cancellationBreached(long cancelled, long accepted, MetricRule rule) {
    return accepted >= rule.minSample()
        && exactPercent(cancelled, accepted).compareTo(rule.maxCancellationPercent()) > 0;
  }

  /**
   * The RATE-02 exposed average: the snapshot average only from {@link #MIN_EXPOSED_RATINGS}
   * ratings on.
   *
   * @param snapshotAverage the snapshot average (may be null)
   * @param snapshotCount the snapshot count
   * @return the exposed average, or null
   */
  public static BigDecimal exposed(BigDecimal snapshotAverage, int snapshotCount) {
    return snapshotCount >= MIN_EXPOSED_RATINGS ? snapshotAverage : null;
  }

  private static RatingRule rule(BigDecimal min, int rides, BigDecimal warn) {
    return new RatingRule(min, rides, warn != null ? warn : min.add(DEFAULT_WARN_MARGIN));
  }

  private static BigDecimal decimal(Object value) {
    if (value == null) {
      return null;
    }
    try {
      return new BigDecimal(value.toString());
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  private static Integer integer(Object value) {
    BigDecimal decimal = decimal(value);
    return decimal == null ? null : decimal.intValue();
  }
}
