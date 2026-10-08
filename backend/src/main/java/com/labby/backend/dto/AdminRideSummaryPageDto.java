package com.labby.backend.dto;

import java.util.List;

/** One page of the admin ride search. */
public record AdminRideSummaryPageDto(
    List<AdminRideSummaryDto> items, int page, int size, long totalItems) {}
