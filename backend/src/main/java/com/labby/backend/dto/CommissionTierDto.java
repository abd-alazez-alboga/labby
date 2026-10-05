package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * One tier of the weekly-recalculated driver commission (COM-02). Ordered descending by threshold;
 * the tier with the highest {@code weeklyTripsAbove} the driver exceeds applies.
 */
public record CommissionTierDto(
    @NotNull @Min(0) Integer weeklyTripsAbove,
    @NotNull @DecimalMin("0") @DecimalMax("100") BigDecimal percent) {}
