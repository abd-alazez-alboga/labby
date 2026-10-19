package com.labby.backend.dto;

import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketSide;
import java.time.Instant;
import java.util.UUID;

/** One history entry (support-v1 {@code TicketEvent}); admin names only to admins. */
public record TicketEventDto(
    UUID eventId,
    TicketEventType type,
    TicketSide actorSide,
    String actorName,
    String fromValue,
    String toValue,
    Instant createdAt) {}
