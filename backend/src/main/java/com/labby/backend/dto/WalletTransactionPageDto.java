package com.labby.backend.dto;

import java.util.List;

/** One newest-first page of wallet history (money-v1 WalletTransactionPage). */
public record WalletTransactionPageDto(
    List<WalletTransactionDto> items, int page, int size, long totalItems, int totalPages) {}
