package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 2FA-gated password change: current password + OTP + new password (AUTH-05). */
public record ChangePasswordRequestDto(
    @NotBlank String currentPassword,
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String otpCode,
    @NotBlank @Size(min = 8, max = 72) String newPassword) {}
