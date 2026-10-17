package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * A completed ride the caller can still rate (trust-v1 PendingRating). {@code memberId} (M12): on a
 * shared ride the driver gets one prompt per completed member, rated with {@code ?memberId=}.
 */
public record PendingRatingDto(
    UUID rideId,
    Instant completedAt,
    Instant windowEndsAt,
    String counterpartFirstName,
    String counterpartPhotoUrl,
    String pickupLabel,
    String destinationLabel,
    UUID memberId) {}
