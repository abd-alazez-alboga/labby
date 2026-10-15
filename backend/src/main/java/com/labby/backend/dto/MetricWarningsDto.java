package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * DRV-07 driver metric warnings per region (M11, regions-v1 MetricWarnings; defaults 50 / 15 / 30
 * days / 20). Warn only, never suspend.
 */
public record MetricWarningsDto(
    @NotNull @DecimalMin("0") @DecimalMax("100") BigDecimal minAcceptancePercent,
    @NotNull @DecimalMin("0") @DecimalMax("100") BigDecimal maxCancellationPercent,
    @NotNull Integer windowDays,
    @NotNull @Min(1) Integer minSample) {}
