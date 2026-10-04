package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Verifies the password-reset OTP (AUTH-03, AUTH-04). */
public record PasswordResetVerifyRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number") String phone,
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String code) {}
