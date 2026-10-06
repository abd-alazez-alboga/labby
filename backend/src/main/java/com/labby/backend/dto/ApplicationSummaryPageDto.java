package com.labby.backend.dto;

import java.util.List;

/**
 * A page of the application queue, oldest submission first (UC-A-10).
 *
 * @param items the rows
 * @param page zero-based page index
 * @param size page size
 * @param totalItems total matching applications
 */
public record ApplicationSummaryPageDto(
    List<ApplicationSummaryDto> items, int page, int size, long totalItems) {}
