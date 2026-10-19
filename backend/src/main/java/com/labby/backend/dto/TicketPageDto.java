package com.labby.backend.dto;

import java.util.List;

/** One page of the user's tickets, most recently updated first. */
public record TicketPageDto(List<TicketDto> items, int page, int size, long totalItems) {}
