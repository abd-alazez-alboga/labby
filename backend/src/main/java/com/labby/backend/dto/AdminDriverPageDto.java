package com.labby.backend.dto;

import java.util.List;

/** One page of the admin drivers list. */
public record AdminDriverPageDto(List<AdminDriverDto> items, int page, int size, long totalItems) {}
