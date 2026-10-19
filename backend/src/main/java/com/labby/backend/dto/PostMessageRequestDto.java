package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** A thread message (support-v1 {@code PostMessageRequest}). */
public record PostMessageRequestDto(@NotBlank @Size(max = 2000) String body) {}
