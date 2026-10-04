package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Starts a password reset: requests an OTP (AUTH-03). The response is neutral regardless of account
 * existence (NFR-S3).
 */
public record PasswordResetStartRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number")
        String phone) {}
