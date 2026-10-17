package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * Create/replace payload for a region's bundle (UC-A-05/06) — {@code name} is the only mandatory
 * field (draft-friendly); a PUT is a full replace, absent optional fields clear — except {@code
 * timeZone}, {@code driverBalanceFloor}, {@code metricWarnings} (M11), {@code scheduledSettings}
 * (M12) and {@code growthSettings} (M13), which an omitted/null value keeps.
 */
public record RegionUpsertRequestDto(
    @NotBlank @Size(max = 100) String name,
    @Valid GeoJsonPolygonDto boundary,
    @Pattern(regexp = "^[A-Z]{3}$") String currency,
    @Size(max = 20) String emergencyNumber,
    @Size(max = 64) String timeZone,
    @Min(0) Integer cancellationGraceMin,
    @DecimalMin("0") BigDecimal cancellationFee,
    @Min(0) Integer waitGraceMin,
    @DecimalMin("0") BigDecimal waitPerMinRate,
    @DecimalMin("0") BigDecimal pickupFeeThresholdKm,
    @DecimalMin("0") BigDecimal pickupFeePerKm,
    @DecimalMin("1") BigDecimal surgeCap,
    @DecimalMax("0") BigDecimal driverBalanceFloor,
    List<@Valid CommissionTierDto> commissionTiers,
    @Valid IncentiveValuesDto incentiveValues,
    @Valid SuspensionThresholdsDto suspensionThresholds,
    @Valid MetricWarningsDto metricWarnings,
    @Valid ScheduledSettingsDto scheduledSettings,
    @Valid GrowthSettingsDto growthSettings) {}
