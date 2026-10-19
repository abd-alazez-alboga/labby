package com.labby.backend.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.LocalTime;
import java.util.List;

/**
 * A peak-hour window (incentives-v1 {@code PeakWindow}, M15 ruling Q1): ISO days (1 = Monday … 7 =
 * Sunday) and region-local times; {@code endsAt} before {@code startsAt} runs past midnight.
 */
public record PeakWindowDto(
    @NotEmpty List<@NotNull @Min(1) @Max(7) Integer> daysOfWeek,
    @NotNull LocalTime startsAt,
    @NotNull LocalTime endsAt) {}
