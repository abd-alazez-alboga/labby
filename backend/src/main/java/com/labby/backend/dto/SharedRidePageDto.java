package com.labby.backend.dto;

import java.util.List;

/** One page of open shared rides. */
public record SharedRidePageDto(List<SharedRideDto> items, int page, int size, long totalItems) {}
