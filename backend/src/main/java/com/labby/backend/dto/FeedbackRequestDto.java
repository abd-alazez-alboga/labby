package com.labby.backend.dto;

import com.labby.backend.enums.RideParty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Submit feedback (support-v1 {@code FeedbackRequest}, UC-S-22). {@code category} is a raw string
 * so an unknown value answers 400 {@code invalid_category}; {@code submittedAs} names the sending
 * app (T2 amendment: the JWT carries no client type), checked against the caller's roles.
 */
public record FeedbackRequestDto(
    @NotBlank String category,
    @NotBlank @Size(max = 2000) String body,
    @NotNull RideParty submittedAs) {}
