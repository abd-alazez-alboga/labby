package com.labby.backend.dto;

import com.labby.backend.enums.ClaimReleaseReason;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Release a claim (UC-D-12 E1): vehicle_issue | unsafe_pickup | other (+ note). */
public record ClaimReleaseRequestDto(
    @NotNull ClaimReleaseReason reason, @Size(max = 500) String note) {}
