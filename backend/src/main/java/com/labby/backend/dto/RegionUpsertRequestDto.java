package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * Create/replace payload for a region's bundle (UC-A-05/06) — {@code name} is the only mandatory
 * field (draft-friendly); a PUT is a full replace, absent optional fields clear.
 */
public record RegionUpsertRequestDto(
    @NotBlank @Size(max = 100) String name,
    @Valid GeoJsonPolygonDto boundary,
    @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @Size(max = 20) String emergencyNumber,
    @Min(0) Integer cancellationGraceMin,
    @DecimalMin("0") BigDecimal cancellationFee,
    @Min(0) Integer waitGraceMin,
    @DecimalMin("0") BigDecimal waitPerMinRate,
    @DecimalMin("0") BigDecimal pickupFeeThresholdKm,
    @DecimalMin("0") BigDecimal pickupFeePerKm,
    @DecimalMin("1") BigDecimal surgeCap,
    List<@Valid CommissionTierDto> commissionTiers,
    @Valid IncentiveValuesDto incentiveValues,
    @Valid SuspensionThresholdsDto suspensionThresholds) {}
