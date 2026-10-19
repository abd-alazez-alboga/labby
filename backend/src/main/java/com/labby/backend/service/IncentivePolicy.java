package com.labby.backend.service;

import com.labby.backend.dto.IncentiveValuesDto;
import com.labby.backend.dto.PeakWindowDto;
import com.labby.backend.dto.WeeklyTripBonusDto;
import com.labby.backend.util.TimeWindows;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * The DRV-08 rules as pure functions (incentives-v1 owner rulings 2026-10-20), shared by the weekly
 * job and the live progress so both always agree.
 */
public final class IncentivePolicy {

  private IncentivePolicy() {}

  /**
   * The tiers ascending by trips.
   *
   * @param config the region's incentive values
   * @return the tiers
   */
  public static List<WeeklyTripBonusDto> tiers(IncentiveValuesDto config) {
    return config.weeklyTripBonuses().stream()
        .sorted(Comparator.comparingInt(WeeklyTripBonusDto::trips))
        .toList();
  }

  /**
   * Ruling Q2: the highest tier the week's trips reach — not cumulative.
   *
   * @param tiers the tiers
   * @param trips the week's completed trips
   * @return the tier that pays, if any
   */
  public static Optional<WeeklyTripBonusDto> reachedTier(
      List<WeeklyTripBonusDto> tiers, int trips) {
    return tiers.stream()
        .filter(tier -> trips >= tier.trips())
        .max(Comparator.comparingInt(WeeklyTripBonusDto::trips));
  }

  /**
   * The lowest tier not yet reached.
   *
   * @param tiers the tiers
   * @param trips the week's completed trips
   * @return the next tier, if any
   */
  public static Optional<WeeklyTripBonusDto> nextTier(List<WeeklyTripBonusDto> tiers, int trips) {
    return tiers.stream()
        .filter(tier -> trips < tier.trips())
        .min(Comparator.comparingInt(WeeklyTripBonusDto::trips));
  }

  /**
   * The region's peak windows (absent = none).
   *
   * @param config the region's incentive values
   * @return the windows
   */
  public static List<PeakWindowDto> windows(IncentiveValuesDto config) {
    return config.peakWindows() == null ? List.of() : config.peakWindows();
  }

  /**
   * Ruling Q1: the window covering a request moment in the region's zone, if any.
   *
   * @param windows the windows
   * @param at the moment
   * @param zone the region's zone
   * @return the covering window
   */
  public static Optional<PeakWindowDto> coveringWindow(
      List<PeakWindowDto> windows, Instant at, ZoneId zone) {
    ZonedDateTime local = at.atZone(zone);
    return windows.stream()
        .filter(w -> TimeWindows.covers(w.daysOfWeek(), w.startsAt(), w.endsAt(), local))
        .findFirst();
  }

  /**
   * The end time of the window in force at a moment (for "peak now · until …").
   *
   * @param windows the windows
   * @param at the moment
   * @param zone the region's zone
   * @return the end time, if a window covers the moment
   */
  public static Optional<LocalTime> activeUntil(
      List<PeakWindowDto> windows, Instant at, ZoneId zone) {
    return coveringWindow(windows, at, zone).map(PeakWindowDto::endsAt);
  }

  /**
   * Ruling Q4: the rating reward pays at or above the minimum average with enough trips. The
   * comparison uses the exact average.
   *
   * @param config the region's incentive values
   * @param average the week's exact average, or null without ratings
   * @param trips the week's completed trips
   * @return true when it pays
   */
  public static boolean ratingQualifies(IncentiveValuesDto config, BigDecimal average, int trips) {
    return average != null
        && trips >= config.ratingReward().minWeeklyTrips()
        && average.compareTo(config.ratingReward().minAvgRating()) >= 0;
  }

  /**
   * The displayed / stored average: 2 decimals rounded DOWN, so a non-qualifying 4.7999 never shows
   * as 4.80.
   *
   * @param average the exact average, or null
   * @return the display value, or null
   */
  public static BigDecimal displayAverage(BigDecimal average) {
    return average == null ? null : average.setScale(2, RoundingMode.DOWN);
  }

  /**
   * An amount in money scale.
   *
   * @param amount the amount
   * @return 2 decimals, HALF_UP
   */
  public static BigDecimal money(BigDecimal amount) {
    return amount.setScale(2, RoundingMode.HALF_UP);
  }
}
