package com.labby.backend.dto;

import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A ticket as its user sees it (support-v1 {@code Ticket}, UC-S-20). */
public record TicketDto(
    UUID ticketId,
    TicketKind kind,
    TicketCategoryDto category,
    TicketPriority priority,
    TicketStatus status,
    CaseStatus caseStatus,
    String description,
    RideLinkDto ride,
    List<AttachmentDto> attachments,
    long unreadSupportMessages,
    Instant lastMessageAt,
    Instant createdAt,
    Instant updatedAt) {}
