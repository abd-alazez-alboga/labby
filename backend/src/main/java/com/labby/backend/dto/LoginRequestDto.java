package com.labby.backend.dto;

import com.labby.backend.enums.ClientType;
import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Phone + password login from a specific client; never OTP-gated (AUTH-02, AUTH-05). */
public record LoginRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID) String phone,
    @NotBlank String password,
    @NotNull ClientType client) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public LoginRequestDto {
    phone = PhoneNumbers.normalize(phone);
  }
}
