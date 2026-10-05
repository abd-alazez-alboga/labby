package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** One USR-05 auto-suspension threshold (per role). */
public record SuspensionThresholdDto(
    @NotNull @DecimalMin("1") @DecimalMax("5") BigDecimal minAvgRating,
    @NotNull @Min(1) Integer minRatedRides) {}
