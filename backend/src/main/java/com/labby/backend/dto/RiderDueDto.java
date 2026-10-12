package com.labby.backend.dto;

import com.labby.backend.enums.RiderDueStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A carried rider charge (money-v1 RiderDue), collected on the next completed ride. */
public record RiderDueDto(
    UUID id,
    String currency,
    BigDecimal amount,
    String type,
    UUID sourceRideId,
    RiderDueStatus status,
    UUID collectedRideId,
    Instant createdAt,
    Instant collectedAt) {}
