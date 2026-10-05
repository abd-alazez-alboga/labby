package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

/** Region incentive config (DRV-08); consumed by M13. */
public record IncentiveValuesDto(
    @NotNull List<@Valid WeeklyTripBonusDto> weeklyTripBonuses,
    @NotNull @DecimalMin("0") BigDecimal peakHourBonusPerTrip,
    @NotNull @Valid RatingRewardDto ratingReward) {}
