package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;

/**
 * Go online / offline (UC-D-04).
 *
 * @param online the requested state
 */
public record AvailabilityUpdateDto(@NotNull Boolean online) {}
