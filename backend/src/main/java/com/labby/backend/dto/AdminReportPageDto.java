package com.labby.backend.dto;

import java.util.List;

/** One page of the reports queue, oldest first. */
public record AdminReportPageDto(
    List<AdminReportSummaryDto> items, int page, int size, long totalElements) {}
