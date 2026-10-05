package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** Weekly rating reward (DRV-08; default: 20 @ avg &gt;= 4.8 with &gt;= 30 trips). */
public record RatingRewardDto(
    @NotNull @DecimalMin("0") BigDecimal amount,
    @NotNull @DecimalMin("1") @DecimalMax("5") BigDecimal minAvgRating,
    @NotNull @Min(0) Integer minWeeklyTrips) {}
