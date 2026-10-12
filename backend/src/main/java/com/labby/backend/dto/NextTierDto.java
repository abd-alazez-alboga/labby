package com.labby.backend.dto;

import java.math.BigDecimal;

/** The next commission tier a driver can earn with more weekly trips (money-v1, COM-02). */
public record NextTierDto(BigDecimal percent, int weeklyTripsAbove) {}
