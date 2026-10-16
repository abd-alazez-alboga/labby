package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One claim-board row (UC-D-11): time, pickup AREA (rounded to ≈ 100 m — exact after claiming),
 * destination and the no-surge estimate (priced at ride time).
 */
public record ClaimBoardEntryDto(
    UUID rideId,
    Instant scheduledAt,
    PlaceDto pickupArea,
    PlaceDto destination,
    int stopsCount,
    UUID serviceTypeId,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    BigDecimal estimatedFare,
    String currency,
    boolean pricedAtRideTime,
    PaymentMethod paymentMethod,
    int estimateDistanceMeters,
    int estimateDurationSeconds) {}
