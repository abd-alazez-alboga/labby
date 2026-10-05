package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * One demand/supply surge step (PRC-02): ratio &gt;= {@code ratio} → {@code multiplier}. Defaults:
 * &gt;=2 → 1.2x, &gt;=3 → 1.5x, &gt;=5 → 2.0x.
 */
public record ThresholdStepDto(
    @NotNull @DecimalMin("1") BigDecimal ratio, @NotNull @DecimalMin("1") BigDecimal multiplier) {}
