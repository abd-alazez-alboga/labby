package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Create/replace payload for a service type (UC-A-07). Types are never deleted — {@code enabled:
 * false} removes them from booking while existing rides keep referencing them.
 */
public record ServiceTypeUpsertRequestDto(
    @NotBlank @Size(max = 50) String nameEn,
    @NotBlank @Size(max = 50) String nameAr,
    @NotNull @DecimalMin("0") BigDecimal baseFare,
    @NotNull @DecimalMin("0") BigDecimal perKmRate,
    @NotNull @DecimalMin("0") BigDecimal perMinRate,
    @NotNull @DecimalMin("0") BigDecimal minimumFare,
    @NotNull Boolean enabled) {}
