package com.labby.backend.dto;

import java.util.List;

/** One page of the caller's points history, newest first. */
public record PointsTransactionPageDto(
    List<PointsTransactionDto> items, int page, int size, long totalItems) {}
