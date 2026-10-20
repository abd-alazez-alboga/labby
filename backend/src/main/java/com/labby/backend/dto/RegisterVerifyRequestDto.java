package com.labby.backend.dto;

import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Verifies the registration OTP (AUTH-01, AUTH-04). */
public record RegisterVerifyRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID) String phone,
    @NotBlank @Pattern(regexp = "^[0-9]{6}$", message = "code must be 6 digits") String code) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public RegisterVerifyRequestDto {
    phone = PhoneNumbers.normalize(phone);
  }
}
