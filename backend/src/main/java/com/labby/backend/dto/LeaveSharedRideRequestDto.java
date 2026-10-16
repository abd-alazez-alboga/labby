package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import jakarta.validation.constraints.Size;

/**
 * Leave a shared ride (UC-R-14): ignored before dispatch; after it a rider cancellation reason is
 * required ({@code other} needs a note).
 */
public record LeaveSharedRideRequestDto(CancellationReason reason, @Size(max = 500) String note) {}
