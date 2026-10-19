package com.labby.backend.dto;

import java.util.List;

/** One page of the admin transactions list. */
public record AdminTransactionPageDto(
    List<AdminTransactionDto> items, int page, int size, long totalItems) {}
