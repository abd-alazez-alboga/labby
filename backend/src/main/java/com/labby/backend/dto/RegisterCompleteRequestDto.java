package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Completes a new registration with password and name (AUTH-01). */
public record RegisterCompleteRequestDto(
    @NotBlank String registrationToken,
    @NotBlank @Size(min = 8, max = 72) String password,
    @NotBlank @Size(max = 100) String name) {}
