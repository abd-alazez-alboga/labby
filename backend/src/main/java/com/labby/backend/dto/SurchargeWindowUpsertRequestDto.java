package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.List;

/** Create/replace payload for a time-window surcharge (PRC-01, e.g. rush +25%). */
public record SurchargeWindowUpsertRequestDto(
    @NotBlank @Size(max = 50) String label,
    @NotNull LocalTime startsAt,
    @NotNull LocalTime endsAt,
    @NotEmpty List<@NotNull @Min(1) @Max(7) Integer> daysOfWeek,
    @NotNull @DecimalMin("0") BigDecimal percent) {}
