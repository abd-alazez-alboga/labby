package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Closes a flag — {@code actioned} or {@code dismissed} — with a mandatory note. */
public record FlagResolveRequestDto(
    @NotNull @Pattern(regexp = "actioned|dismissed") String resolution,
    @NotBlank @Size(max = 2000) String note) {}
