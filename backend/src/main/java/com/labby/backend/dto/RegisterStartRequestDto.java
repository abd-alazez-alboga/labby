package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Starts registration: requests an OTP for the phone (AUTH-01). */
public record RegisterStartRequestDto(
    @NotBlank @Pattern(regexp = "^\\+?[0-9]{8,15}$", message = "invalid phone number")
        String phone) {}
