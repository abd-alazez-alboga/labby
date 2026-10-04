package com.labby.backend.dto;

import com.labby.backend.enums.Language;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Profile update: name and interface language (USR-03). */
public record UpdateProfileRequestDto(
    @NotBlank @Size(max = 100) String name, @NotNull Language language) {}
