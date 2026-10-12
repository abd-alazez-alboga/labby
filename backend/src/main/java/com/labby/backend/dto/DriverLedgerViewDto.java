package com.labby.backend.dto;

import java.util.List;

/** A driver's ledger: balances + one newest-first page (money-v1 DriverLedgerView, UC-A-27). */
public record DriverLedgerViewDto(
    List<DriverBalanceEntryDto> balances,
    List<DriverLedgerEntryDto> entries,
    int page,
    int size,
    long totalItems,
    int totalPages) {}
