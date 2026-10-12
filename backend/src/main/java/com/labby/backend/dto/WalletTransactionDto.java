package com.labby.backend.dto;

import com.labby.backend.enums.WalletTransactionType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One typed wallet ledger entry, signed (money-v1 WalletTransaction, UC-R-17). */
public record WalletTransactionDto(
    UUID id,
    String currency,
    BigDecimal amount,
    WalletTransactionType type,
    UUID rideId,
    String reason,
    BigDecimal balanceAfter,
    Instant createdAt) {}
