package com.labby.backend.dto;

import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.ChatWindowState;
import com.labby.backend.enums.TicketStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A lost-item case as either party sees it (support-v1 {@code LostItemCase}, UC-R-20/UC-D-21). */
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
    Instant createdAt,
    Instant updatedAt) {}
