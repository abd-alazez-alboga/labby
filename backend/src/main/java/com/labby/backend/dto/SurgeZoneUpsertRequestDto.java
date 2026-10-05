package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * Create/replace payload for a surge zone (UC-A-08). The polygon must lie within the region's
 * boundary (M4-T2 rule).
 */
public record SurgeZoneUpsertRequestDto(
    @NotBlank @Size(max = 100) String name,
    @NotNull @Valid GeoJsonPolygonDto polygon,
    @NotEmpty List<@Valid ThresholdStepDto> thresholdSteps,
    @DecimalMin("1") BigDecimal multiplierCap) {}
