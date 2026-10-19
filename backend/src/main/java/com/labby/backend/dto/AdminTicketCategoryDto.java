package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import java.time.Instant;
import java.util.UUID;

/** A ticket category as admins manage it (support-v1 {@code AdminTicketCategory}, UC-A-24). */
public record AdminTicketCategoryDto(
    UUID ticketCategoryId,
    String systemCode,
    String nameEn,
    String nameAr,
    TicketPriority defaultPriority,
    int sortOrder,
    boolean active,
    long ticketCount,
    Instant createdAt,
    Instant updatedAt) {}
