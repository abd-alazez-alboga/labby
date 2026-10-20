package com.labby.backend.dto;

import java.util.List;

/**
 * One page of the claim board, soonest first. {@code blockedReason} (V1 audit H7, owner ruling
 * 2026-10-20) says why the board is empty for this driver — {@code balance_below_floor} (COM-03) —
 * or is null when the board is open to them.
 */
public record ClaimBoardPageDto(
    List<ClaimBoardEntryDto> items, int page, int size, long totalItems, String blockedReason) {}
