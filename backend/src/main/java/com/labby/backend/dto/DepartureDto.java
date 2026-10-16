package com.labby.backend.dto;

import com.labby.backend.enums.SharedDepartureMode;
import java.time.Instant;

/**
 * A shared ride's departure: {@code departAt} for timed rides, {@code expiresAt} for "when full".
 */
public record DepartureDto(SharedDepartureMode mode, Instant departAt, Instant expiresAt) {}
