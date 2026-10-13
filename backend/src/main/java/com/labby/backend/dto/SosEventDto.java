package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import java.time.Instant;
import java.util.UUID;

/**
 * One recorded SOS event (comms-v1.yaml {@code SosEvent}, SAFE-01/02).
 *
 * @param sosEventId the event id
 * @param rideId the ride
 * @param triggeredByRole rider or driver
 * @param lat latitude at the tap
 * @param lng longitude
 * @param triggeredAt device moment, clamped to server time
 * @param createdAt when the server recorded it
 */
public record SosEventDto(
    UUID sosEventId,
    UUID rideId,
    RideParty triggeredByRole,
    double lat,
    double lng,
    Instant triggeredAt,
    Instant createdAt) {}
