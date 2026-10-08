package com.labby.backend.dto;

import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A history row. */
public record RideSummaryDto(
    UUID id,
    RideState state,
    Instant requestedAt,
    PlaceDto pickup,
    PlaceDto destination,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    BigDecimal total,
    BigDecimal cancellationFee,
    String currency) {}
