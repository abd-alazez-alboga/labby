package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import java.util.List;

/** A ticket with its thread and history, oldest first (support-v1 {@code TicketDetail}). */
public record TicketDetailDto(
    @JsonUnwrapped TicketDto ticket,
    List<TicketMessageDto> messages,
    List<TicketEventDto> events) {}
