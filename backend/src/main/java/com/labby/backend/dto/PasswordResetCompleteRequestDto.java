package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Sets the new password after a verified reset; all sessions are invalidated (AUTH-03). */
public record PasswordResetCompleteRequestDto(
    @NotBlank String resetToken, @NotBlank @Size(min = 8, max = 72) String newPassword) {}
