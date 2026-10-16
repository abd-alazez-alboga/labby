package com.labby.backend.dto;

import com.labby.backend.enums.SharedDepartureMode;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/** A shared ride's departure rule (RIDE-P1): {@code at_time} needs {@code departAt}. */
public record DepartureRequestDto(@NotNull SharedDepartureMode mode, Instant departAt) {}
