package com.labby.backend.dto;

import com.labby.backend.enums.FloorStatus;
import com.labby.backend.enums.SettlementDirection;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A recorded settlement with the new balance and floor standing (money-v1 SettlementResponse). */
public record SettlementResponseDto(
    UUID id,
    UUID driverUserId,
    String currency,
    BigDecimal amount,
    SettlementDirection direction,
    String note,
    Instant createdAt,
    BigDecimal balance,
    FloorStatus floorStatus) {}
