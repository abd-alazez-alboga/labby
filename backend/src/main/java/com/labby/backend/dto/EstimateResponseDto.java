package com.labby.backend.dto;

import com.labby.backend.enums.PickupDistanceMode;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Estimates of every enabled service type of the pickup region (RIDE-01). */
public record EstimateResponseDto(
    UUID regionId,
    String currency,
    BigDecimal surgeMultiplier,
    BigDecimal surchargePercent,
    RouteSummaryDto route,
    List<ServiceTypeEstimateDto> options,
    PickupDistanceMode pickupDistanceMode,
    PickupFeeRuleDto pickupFeeRule) {}
