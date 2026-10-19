package com.labby.backend.dto;

import com.labby.backend.enums.TicketStatus;
import jakarta.validation.constraints.NotNull;

/** Move a plain ticket's status (UC-A-21). */
public record TicketStatusRequestDto(@NotNull TicketStatus status) {}
