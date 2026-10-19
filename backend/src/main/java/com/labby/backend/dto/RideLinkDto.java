package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/** Enough to render a ticket's ride row (support-v1 {@code RideLink}). */
public record RideLinkDto(
    UUID rideId, String kind, String state, Instant startedAt, String counterpartName) {}
