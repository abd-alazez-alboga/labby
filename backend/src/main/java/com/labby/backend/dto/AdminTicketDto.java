package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.labby.backend.enums.TicketSide;
import java.time.Instant;
import java.util.UUID;

/** A ticket as the queue shows it (support-v1 {@code AdminTicket}, UC-A-21). */
public record AdminTicketDto(
    @JsonUnwrapped TicketDto ticket,
    PartySummaryDto user,
    OpenedByDto openedBy,
    AssigneeDto assignee,
    UUID sosEventId,
    Instant waitingSince,
    Instant reminderSentAt,
    Instant resolvedAt,
    Instant closedAt,
    long ageSeconds) {

  /** Who opened the ticket: the user, or the admin of an SOS-linked ticket. */
  public record OpenedByDto(UUID userId, String name, TicketSide side) {}

  /** The handling admin. */
  public record AssigneeDto(UUID userId, String name) {}
}
