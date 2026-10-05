package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** DRV-08 weekly trip bonus step (defaults: 50 @ 40+, 100 @ 60+). */
public record WeeklyTripBonusDto(
    @NotNull @Min(1) Integer trips, @NotNull @DecimalMin("0") BigDecimal amount) {}
