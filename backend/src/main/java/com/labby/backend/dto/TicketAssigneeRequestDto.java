package com.labby.backend.dto;

import java.util.UUID;

/** Assign (or unassign with null) a handling admin. */
public record TicketAssigneeRequestDto(UUID assigneeUserId) {}
