package com.labby.backend.dto;

import com.labby.backend.enums.ClientType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Phone + password login from a specific client; never OTP-gated (AUTH-02, AUTH-05). */
public record LoginRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number") String phone,
    @NotBlank String password,
    @NotNull ClientType client) {}
