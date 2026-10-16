package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A rider / driver history row (rides-v1 PartyRideSummary). M11: {@code myRating} is the caller's
 * own rating state for the ride (same shape as {@code Ride.myRating}); {@code counterpartFirstName}
 * is the driver's first name in the rider's history, the rider's in the driver's — null when the
 * ride never had a driver; {@code cancellationReason} is the ride's reason (incl. the system's
 * {@code account_suspended}), null when not cancelled.
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
    CancellationReason cancellationReason) {}
