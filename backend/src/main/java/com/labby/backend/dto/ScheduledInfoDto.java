package com.labby.backend.dto;

import java.time.Instant;

/**
 * The scheduled extension on a ride of kind {@code scheduled} (scheduled-shared-v1 ScheduledInfo).
 * {@code claimState}: open | claimed | converted | fallen_back. {@code claimedBy} is set in the
 * rider view of a claimed, not yet converted ride.
 */
public record ScheduledInfoDto(
    Instant scheduledAt,
    String claimState,
    Instant claimedAt,
    boolean pricedAtRideTime,
    DriverSummaryDto claimedBy) {}
