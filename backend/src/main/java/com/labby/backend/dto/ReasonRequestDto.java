package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A rejection with its reason.
 *
 * @param reason the reason shown to the driver
 */
public record ReasonRequestDto(@NotBlank @Size(max = 1000) String reason) {}
