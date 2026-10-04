package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 2FA-gated soft deletion of the own account (USR-07, AUTH-05). */
public record DeleteAccountRequestDto(
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String otpCode) {}
