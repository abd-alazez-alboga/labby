package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/**
 * USR-05 auto-suspension on rating, per role (defaults: driver &lt; 3.0 after &gt;= 20 rated rides;
 * rider &lt; 2.5 after &gt;= 10). Consumed by M11.
 */
public record SuspensionThresholdsDto(
    @NotNull @Valid SuspensionThresholdDto driver, @NotNull @Valid SuspensionThresholdDto rider) {}
