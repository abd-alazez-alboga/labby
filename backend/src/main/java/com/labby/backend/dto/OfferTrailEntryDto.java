package com.labby.backend.dto;

import com.labby.backend.enums.OfferResponse;
import java.time.Instant;
import java.util.UUID;

/** One offer of the dispatch trail (UC-A-18, RIDE-03). */
public record OfferTrailEntryDto(
    UUID offerId,
    int sequence,
    UUID driverUserId,
    String driverName,
    UUID vehicleId,
    Instant offeredAt,
    Instant expiresAt,
    OfferResponse response,
    Instant respondedAt,
    long pickupDistanceMeters,
    long pickupEtaSeconds) {}
