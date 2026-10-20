package com.labby.backend.dto;

import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Starts the 2FA-gated phone change toward a new, unused phone (AUTH-05, ES-02). */
public record PhoneChangeStartRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID)
        String newPhone) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public PhoneChangeStartRequestDto {
    newPhone = PhoneNumbers.normalize(newPhone);
  }
}
