package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;

/** Exchanges a refresh token for a rotated token pair (NFR-S1). */
public record RefreshRequestDto(@NotBlank String refreshToken) {}
