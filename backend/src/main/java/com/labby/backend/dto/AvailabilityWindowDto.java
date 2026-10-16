package com.labby.backend.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * One weekly window (DRV-05): ISO weekday and {@code HH:mm} times, read in the ride region's zone;
 * {@code endsAt} before {@code startsAt} spans midnight, equal times cover the whole day.
 */
public record AvailabilityWindowDto(
    @NotNull @Min(1) @Max(7) Integer dayOfWeek,
    @NotNull @Pattern(regexp = "^([01][0-9]|2[0-3]):[0-5][0-9]$") String startsAt,
    @NotNull @Pattern(regexp = "^([01][0-9]|2[0-3]):[0-5][0-9]$") String endsAt) {}
