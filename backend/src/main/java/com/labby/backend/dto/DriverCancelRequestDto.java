package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Driver cancellation: a driver reason; {@code other} needs a note. */
public record DriverCancelRequestDto(
    @NotNull CancellationReason reason, @Size(max = 500) String note) {}
