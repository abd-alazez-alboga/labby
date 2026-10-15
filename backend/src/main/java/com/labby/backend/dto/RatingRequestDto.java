package com.labby.backend.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** RATE-01: a 1..5 score with an optional comment (trust-v1 RatingRequest). */
public record RatingRequestDto(
    @NotNull @Min(1) @Max(5) Integer score, @Size(max = 1000) String comment) {}
