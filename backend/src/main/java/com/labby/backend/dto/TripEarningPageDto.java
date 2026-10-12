package com.labby.backend.dto;

import java.util.List;

/** One newest-first page of per-trip earnings (money-v1 TripEarningPage, UC-D-15). */
public record TripEarningPageDto(
    List<TripEarningDto> items, int page, int size, long totalItems, int totalPages) {}
