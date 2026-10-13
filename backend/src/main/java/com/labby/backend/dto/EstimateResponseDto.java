package com.labby.backend.dto;

import com.labby.backend.enums.PickupDistanceMode;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Estimates of every enabled service type of the pickup region (RIDE-01). The surge multiplier is
 * the pickup zone's current value (PRC-02): {@code surgeActive} when above 1.00, with the zone's
 * name (null without surge) for the UC-R-04 A2 explanation. Booking locks the same value.
 */
public record EstimateResponseDto(
    UUID regionId,
    String currency,
    BigDecimal surgeMultiplier,
    boolean surgeActive,
    String surgeZoneName,
    BigDecimal surchargePercent,
    RouteSummaryDto route,
    List<ServiceTypeEstimateDto> options,
    PickupDistanceMode pickupDistanceMode,
    PickupFeeRuleDto pickupFeeRule) {}
