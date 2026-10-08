package com.labby.backend.dto;

import java.time.Instant;

/** One timestamp per reached state (RIDE-02). */
public record RideTimelineDto(
    Instant requestedAt,
    Instant offeringAt,
    Instant acceptedAt,
    Instant driverArrivedAt,
    Instant startedAt,
    Instant completedAt,
    Instant cancelledAt,
    Instant noDriverFoundAt) {}
