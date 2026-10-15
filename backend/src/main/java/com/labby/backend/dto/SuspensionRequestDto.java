package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** USR-06: the mandatory reason of a suspend / reactivate — stored, audited, shown to the user. */
public record SuspensionRequestDto(@NotBlank @Size(max = 500) String note) {}
