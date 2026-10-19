package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

/**
 * Region incentive config (DRV-08), evaluated weekly by the M15 incentives engine. {@code
 * peakWindows} (M15-T3, incentives-v1 ruling Q1) is optional: absent = no window; a peak bonus
 * above 0 needs at least one (checked on save).
 */
public record IncentiveValuesDto(
    @NotNull List<@Valid WeeklyTripBonusDto> weeklyTripBonuses,
    @NotNull @DecimalMin("0") BigDecimal peakHourBonusPerTrip,
    @NotNull @Valid RatingRewardDto ratingReward,
    List<@Valid PeakWindowDto> peakWindows) {}
