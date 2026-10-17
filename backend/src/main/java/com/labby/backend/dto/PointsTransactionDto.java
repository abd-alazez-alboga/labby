package com.labby.backend.dto;

import com.labby.backend.enums.PointsTransactionType;
import java.time.Instant;
import java.util.UUID;

/** One signed points movement (growth-v1 PointsTransaction). */
public record PointsTransactionDto(
    UUID pointsTransactionId,
    PointsTransactionType type,
    long points,
    UUID rideId,
    UUID challengeId,
    UUID walletTransactionId,
    Instant createdAt) {}
