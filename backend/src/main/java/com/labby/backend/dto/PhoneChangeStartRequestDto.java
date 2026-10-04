package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Starts the 2FA-gated phone change toward a new, unused phone (AUTH-05, ES-02). */
public record PhoneChangeStartRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number")
        String newPhone) {}
