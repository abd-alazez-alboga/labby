package com.labby.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Create / rename a help category (support-v1 {@code SaveHelpCategoryRequest}). */
public record SaveHelpCategoryRequestDto(
    @NotBlank @Size(max = 80) String nameEn, @NotBlank @Size(max = 80) String nameAr) {}
