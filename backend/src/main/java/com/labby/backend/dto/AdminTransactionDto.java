package com.labby.backend.dto;

import com.labby.backend.enums.TransactionSource;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A transactions-list row (analytics-v1 {@code AdminTransaction}): a rider wallet transaction or a
 * driver ledger entry (ruling Q5); {@code type} is that ledger's own type value.
 */
public record AdminTransactionDto(
    UUID transactionId,
    TransactionSource source,
    UUID userId,
    String userName,
    String type,
    BigDecimal amount,
    String currency,
    UUID rideId,
    BigDecimal balanceAfter,
    String reason,
    Instant createdAt) {}
