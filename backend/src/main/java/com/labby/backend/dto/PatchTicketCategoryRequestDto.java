package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import jakarta.validation.constraints.Size;

/** Edit a ticket category; every field optional (support-v1 {@code PatchTicketCategoryRequest}). */
public record PatchTicketCategoryRequestDto(
    @Size(max = 80) String nameEn,
    @Size(max = 80) String nameAr,
    TicketPriority defaultPriority,
    Integer sortOrder,
    Boolean active) {}
