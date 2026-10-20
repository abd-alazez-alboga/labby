package com.labby.backend.dto;

import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * An admin search row (UC-A-18). {@code sharedSeats} / {@code sharedParties} (review V1 W15, the
 * rides list's "Shared · 3 seats" and "Nour S. + 2"): set on shared rides only — the seats the fare
 * was split over once completed, else the seats held; and the parties riding (joined or completed
 * members, the creator included). Null on other kinds.
 */
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
    String driverName,
    Integer sharedSeats,
    Integer sharedParties) {}
