package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/** A completed ride the caller can still rate (trust-v1 PendingRating). */
public record PendingRatingDto(
    UUID rideId,
    Instant completedAt,
    Instant windowEndsAt,
    String counterpartFirstName,
    String counterpartPhotoUrl,
    String pickupLabel,
    String destinationLabel) {}
