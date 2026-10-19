package com.labby.backend.dto;

import java.util.List;

/** One page of a party's lost-item cases, most recently updated first. */
public record LostItemCasePageDto(
    List<LostItemCaseDto> items, int page, int size, long totalItems) {}
