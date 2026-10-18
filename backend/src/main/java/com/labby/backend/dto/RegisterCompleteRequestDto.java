package com.labby.backend.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Completes a new registration with password, name, and Terms-of-Service consent (AUTH-01, UC-S-01
 * step 4). Consent is mandatory and its timestamp is stored on the account. {@code referralCode}
 * (optional, GRW-03 / UC-R-18, M13-T5) is a friend's share code captured with the account in the
 * same transaction: an unknown code (404 {@code referral_code_not_found}) or a phone that already
 * used a referral (409 {@code referral_phone_used}) refuses the registration so the rider can fix
 * or clear the field.
 */
public record RegisterCompleteRequestDto(
    @NotBlank String registrationToken,
    @NotBlank @Size(min = 8, max = 72) String password,
    @NotBlank @Size(max = 100) String name,
    @NotNull @AssertTrue(message = "terms must be accepted") Boolean termsAccepted,
    @Size(max = 32) String referralCode) {}
