package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Create a ticket category (support-v1 {@code SaveTicketCategoryRequest}). */
public record SaveTicketCategoryRequestDto(
    @NotBlank @Size(max = 80) String nameEn,
    @NotBlank @Size(max = 80) String nameAr,
    @NotNull TicketPriority defaultPriority,
    Integer sortOrder) {}
