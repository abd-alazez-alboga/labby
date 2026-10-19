package com.labby.backend.dto;

import java.util.List;

/** One page of the ticket queue: priority first, then age (SUP-03). */
public record AdminTicketPageDto(List<AdminTicketDto> items, int page, int size, long totalItems) {}
