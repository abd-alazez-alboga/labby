package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * M13 growth knobs per region (owner ruling 4, 2026-10-18; growth-v1): referral reward amounts in
 * the region currency, the loyalty accrual rate and the redemption rule. NULL on the region = the
 * code defaults (referral amounts 0 = nothing paid until configured).
 */
public record GrowthSettingsDto(
    @NotNull @DecimalMin("0") BigDecimal referralReferrerAmount,
    @NotNull @DecimalMin("0") BigDecimal referralRefereeAmount,
    @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal pointsPerCurrencyUnit,
    @NotNull @Min(1) Long redemptionThresholdPoints,
    @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal redemptionRate) {}
