package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A rider / driver history row (rides-v1 PartyRideSummary). M11: {@code myRating} is the caller's
 * own rating state for the ride (same shape as {@code Ride.myRating}); {@code counterpartFirstName}
 * is the driver's first name in the rider's history, the rider's in the driver's — null when the
 * ride never had a driver; {@code cancellationReason} is the ride's reason (incl. the system's
 * {@code account_suspended}), null when not cancelled. V1 conformance W41: {@code kind} labels the
 * row (on-demand / scheduled / shared) and {@code partySize} is the rider's own seats on a shared
 * ride (rider history only; null otherwise).
 */
public record RideSummaryDto(
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
    MyRatingDto myRating,
    String counterpartFirstName,
    CancellationReason cancellationReason,
    RideKind kind,
    Short partySize) {}
