package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import java.util.UUID;

/**
 * A pickable ticket category (support-v1 {@code TicketCategory}, SUP-01). {@code systemCode} names
 * a seeded system category (e.g. {@code account_suspend}, review V1 W39 — the apps pre-select it by
 * code); null for the categories admins create.
 */
public record TicketCategoryDto(
    UUID ticketCategoryId,
    String systemCode,
    LocalizedTextDto name,
    TicketPriority defaultPriority,
    int sortOrder) {}
