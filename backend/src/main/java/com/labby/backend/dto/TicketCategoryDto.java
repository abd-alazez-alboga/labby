package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import java.util.UUID;

/** A pickable ticket category (support-v1 {@code TicketCategory}, SUP-01). */
public record TicketCategoryDto(
    UUID ticketCategoryId, LocalizedTextDto name, TicketPriority defaultPriority, int sortOrder) {}
