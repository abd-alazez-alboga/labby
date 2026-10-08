package com.labby.backend.dto;

import java.util.List;

/** One page of ride history. */
public record RideSummaryPageDto(List<RideSummaryDto> items, int page, int size, long totalItems) {}
