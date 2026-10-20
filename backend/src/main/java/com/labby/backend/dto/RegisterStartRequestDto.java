package com.labby.backend.dto;

import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Starts registration: requests an OTP for the phone (AUTH-01). */
public record RegisterStartRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID) String phone) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public RegisterStartRequestDto {
    phone = PhoneNumbers.normalize(phone);
  }
}
