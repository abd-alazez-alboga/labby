package com.labby.backend.dto;

import java.util.List;

/** One page of the flagged-accounts queue, oldest first. */
public record AccountFlagPageDto(
    List<AccountFlagDto> items, int page, int size, long totalElements) {}
