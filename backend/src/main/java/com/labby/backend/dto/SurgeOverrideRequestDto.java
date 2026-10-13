package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * A manual surge override (UC-A-09): at least 1.00, at most 2 decimals, and within the zone's
 * effective cap (the lower of zone cap and region cap, when set — checked by the service).
 */
public record SurgeOverrideRequestDto(
    @NotNull @DecimalMin("1.00") @Digits(integer = 2, fraction = 2) BigDecimal multiplier) {}
