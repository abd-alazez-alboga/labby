package com.labby.backend.dto;

import com.labby.backend.enums.IncentiveKind;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/** One paid incentive (incentives-v1 {@code IncentiveAward}). */
public record IncentiveAwardDto(
    LocalDate weekStart,
    IncentiveKind kind,
    BigDecimal amount,
    String currency,
    int trips,
    Integer threshold,
    BigDecimal avgRating,
    Instant awardedAt) {}
