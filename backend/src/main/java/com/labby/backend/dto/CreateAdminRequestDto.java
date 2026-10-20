package com.labby.backend.dto;

import com.labby.backend.util.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Super Admin creates an admin with exactly one role (UC-A-01, AUTH-06). */
public record CreateAdminRequestDto(
    @NotBlank @Pattern(regexp = PhoneNumbers.E164, message = PhoneNumbers.INVALID) String phone,
    @NotBlank @Size(max = 100) String name,
    @NotNull UUID roleId) {

  /** Canonicalizes the phone to E.164 before validation (owner ruling 2026-10-20). */
  public CreateAdminRequestDto {
    phone = PhoneNumbers.normalize(phone);
  }
}
