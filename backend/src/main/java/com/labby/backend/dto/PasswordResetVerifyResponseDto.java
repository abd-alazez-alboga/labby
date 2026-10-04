package com.labby.backend.dto;

/** Short-lived token proving the reset OTP was verified. */
public record PasswordResetVerifyResponseDto(String resetToken) {}
