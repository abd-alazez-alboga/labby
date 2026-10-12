package com.labby.backend.dto;

import com.labby.backend.enums.DriverLedgerType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One typed driver ledger entry, signed (money-v1 DriverLedgerEntry). */
public record DriverLedgerEntryDto(
    UUID id,
    String currency,
    BigDecimal amount,
    DriverLedgerType type,
    UUID rideId,
    UUID settlementId,
    UUID riderDueId,
    BigDecimal fareAmount,
    BigDecimal commissionRate,
    BigDecimal commissionAmount,
    BigDecimal balanceAfter,
    Instant createdAt) {}
