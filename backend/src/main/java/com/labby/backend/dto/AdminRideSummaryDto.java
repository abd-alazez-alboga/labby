package com.labby.backend.dto;

import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** An admin search row (UC-A-18). */
public record AdminRideSummaryDto(
    UUID id,
    RideState state,
    Instant requestedAt,
    PlaceDto pickup,
    PlaceDto destination,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    BigDecimal total,
    BigDecimal cancellationFee,
    String currency,
    RideKind kind,
    UUID regionId,
    String regionName,
    UUID riderUserId,
    String riderName,
    UUID driverUserId,
    String driverName) {}
