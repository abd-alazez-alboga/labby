package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * A driver's live incentive progress in one region this week (incentives-v1 {@code
 * IncentiveProgress}, UC-D-17). The three blocks are null when the region has no incentive values.
 */
public record IncentiveProgressDto(
    UUID regionId,
    String regionName,
    boolean configured,
    String currency,
    LocalDate weekStart,
    LocalDate weekEnd,
    String timeZone,
    WeeklyTripsDto weeklyTrips,
    PeakDto peak,
    RatingDto rating,
    List<IncentiveAwardDto> recentAwards) {

  /** A trip tier. */
  public record TierDto(int trips, BigDecimal amount) {}

  /** Weekly trip bonus progress (ruling Q2: the highest tier reached pays). */
  public record WeeklyTripsDto(
      int trips, List<TierDto> tiers, TierDto reachedTier, TierDto nextTier) {}

  /** Peak-hour bonus progress (ruling Q1/Q3). */
  public record PeakDto(
      BigDecimal bonusPerTrip,
      List<PeakWindowDto> windows,
      boolean activeNow,
      LocalTime activeUntil,
      int trips,
      BigDecimal earned) {}

  /** Weekly rating reward progress (ruling Q4). */
  public record RatingDto(
      BigDecimal amount,
      BigDecimal minAvgRating,
      int minWeeklyTrips,
      BigDecimal average,
      long ratingCount,
      int trips,
      boolean qualifies) {}
}
