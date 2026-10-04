package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Verifies the registration OTP (AUTH-01, AUTH-04). */
public record RegisterVerifyRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number") String phone,
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String code) {}
