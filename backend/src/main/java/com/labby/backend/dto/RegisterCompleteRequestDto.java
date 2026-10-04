package com.labby.backend.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Completes a new registration with password, name, and Terms-of-Service consent (AUTH-01, UC-S-01
 * step 4). Consent is mandatory and its timestamp is stored on the account.
 */
public record RegisterCompleteRequestDto(
    @NotBlank String registrationToken,
    @NotBlank @Size(min = 8, max = 72) String password,
    @NotBlank @Size(max = 100) String name,
    @NotNull @AssertTrue(message = "terms must be accepted") Boolean termsAccepted) {}
