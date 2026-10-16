package com.labby.backend.dto;

import java.util.List;

/** One page of the claim board, soonest first. */
public record ClaimBoardPageDto(
    List<ClaimBoardEntryDto> items, int page, int size, long totalItems) {}
