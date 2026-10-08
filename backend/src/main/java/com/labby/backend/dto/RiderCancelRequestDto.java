package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Rider cancellation: a rider reason; {@code other} needs a note. */
public record RiderCancelRequestDto(
    @NotNull CancellationReason reason, @Size(max = 500) String note) {}
