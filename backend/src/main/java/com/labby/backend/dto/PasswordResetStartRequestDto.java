package com.labby.backend.dto;

import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Starts a password reset: requests an OTP (AUTH-03). The response is neutral regardless of account
 * existence (NFR-S3).
 */
public record PasswordResetStartRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID) String phone) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public PasswordResetStartRequestDto {
    phone = PhoneNumbers.normalize(phone);
  }
}
