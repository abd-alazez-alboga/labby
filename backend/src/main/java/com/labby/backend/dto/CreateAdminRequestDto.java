package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Super Admin creates an admin with exactly one role (UC-A-01, AUTH-06). */
public record CreateAdminRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number") String phone,
    @NotBlank @Size(max = 100) String name,
    @NotNull UUID roleId) {}
