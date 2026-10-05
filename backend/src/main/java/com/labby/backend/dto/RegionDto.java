package com.labby.backend.dto;

import com.labby.backend.enums.RegionState;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The full ADM-01 config bundle (regions-v1.yaml Region). Nullable fields are simply not set yet
 * (draft).
 */
public record RegionDto(
    UUID id,
    String name,
    RegionState state,
    GeoJsonPolygonDto boundary,
    String currency,
    String emergencyNumber,
    Integer cancellationGraceMin,
    BigDecimal cancellationFee,
    Integer waitGraceMin,
    BigDecimal waitPerMinRate,
    BigDecimal pickupFeeThresholdKm,
    BigDecimal pickupFeePerKm,
    BigDecimal surgeCap,
    List<CommissionTierDto> commissionTiers,
    IncentiveValuesDto incentiveValues,
    SuspensionThresholdsDto suspensionThresholds,
    long serviceTypeCount,
    long surgeZoneCount) {}
