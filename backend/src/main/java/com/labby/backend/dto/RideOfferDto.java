package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** An offer card (UC-D-06). */
public record RideOfferDto(
    UUID id,
    UUID rideId,
    Instant offeredAt,
    Instant expiresAt,
    PlaceDto pickup,
    long pickupDistanceMeters,
    long pickupEtaSeconds,
    PlaceDto destination,
    List<PlaceDto> stops,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    BigDecimal estimatedFare,
    String currency,
    boolean surge,
    PaymentMethod paymentMethod,
    RiderSummaryDto rider) {}
