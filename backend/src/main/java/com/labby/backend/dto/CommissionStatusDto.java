package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

/** The driver's current weekly commission rate and next-tier progress (money-v1, COM-02). */
public record CommissionStatusDto(
    BigDecimal percent,
    LocalDate weekStart,
    int weeklyTrips,
    int currentWeekTrips,
    NextTierDto nextTier) {}
