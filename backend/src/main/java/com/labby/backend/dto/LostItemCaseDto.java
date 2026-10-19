package com.labby.backend.dto;

import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.ChatWindowState;
import com.labby.backend.enums.TicketStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A lost-item case as either party sees it (support-v1 {@code LostItemCase}, UC-R-20/UC-D-21).
 * {@code memberId} is the reporter's shared-ride member (null on one-rider rides) — the driver
 * addresses that member's chat (T6 amendment h); {@code outcome} is the last of found / not_found /
 * returned the case reached, kept after closure (T6 amendment i).
 */
public record LostItemCaseDto(
    UUID ticketId,
    CaseStatus caseStatus,
    TicketStatus status,
    String description,
    List<AttachmentDto> photos,
    RideLinkDto ride,
    PartySummaryDto reporter,
    PartySummaryDto driver,
    ChatWindowState chatWindow,
    UUID memberId,
    CaseStatus outcome,
    Instant createdAt,
    Instant updatedAt) {}
