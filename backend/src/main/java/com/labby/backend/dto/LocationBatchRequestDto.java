package com.labby.backend.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * The REST fallback's batch of samples (e.g. after a reconnect).
 *
 * @param samples 1..20 samples; the newest becomes the current position
 */
public record LocationBatchRequestDto(
    @NotNull @Size(min = 1, max = 20) List<@NotNull @Valid LocationSampleDto> samples) {}
