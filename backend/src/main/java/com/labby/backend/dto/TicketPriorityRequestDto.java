package com.labby.backend.dto;

import com.labby.backend.enums.TicketPriority;
import jakarta.validation.constraints.NotNull;

/** Override a ticket's priority (UC-A-21 A1). */
public record TicketPriorityRequestDto(@NotNull TicketPriority priority) {}
