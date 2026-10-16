package com.labby.backend.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * RIDE-S timing per region (M12, regions-v1 ScheduledSettings; defaults 1440 / 60 / 15 / 30), in
 * minutes before the pickup. Ordering is checked by the region service.
 */
public record ScheduledSettingsDto(
    @NotNull @Min(1) Integer reminderFirstMin,
    @NotNull @Min(1) Integer reminderSecondMin,
    @NotNull @Min(1) Integer fallbackLeadMin,
    @NotNull @Min(1) Integer minLeadMin) {}
