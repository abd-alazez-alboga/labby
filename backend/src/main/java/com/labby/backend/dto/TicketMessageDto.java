package com.labby.backend.dto;

import com.labby.backend.enums.TicketSide;
import java.time.Instant;
import java.util.UUID;

/**
 * One thread message (support-v1 {@code TicketMessage}). {@code senderName} on the support side is
 * the admin's name to admins and the localized "Labby support" to users.
 */
public record TicketMessageDto(
    UUID messageId,
    UUID ticketId,
    TicketSide senderSide,
    String senderName,
    String body,
    Instant createdAt) {}
