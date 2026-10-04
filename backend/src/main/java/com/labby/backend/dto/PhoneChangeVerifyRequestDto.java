package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Carries one OTP step of the phone change: verify-current (code sent to the old phone) or complete
 * (code sent to the new phone).
 */
public record PhoneChangeVerifyRequestDto(
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String code) {}
