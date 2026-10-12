package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** An applied tip (money-v1 TipResponse): 100% to the driver, commission-free. */
public record TipResponseDto(
    UUID rideId, BigDecimal amount, String currency, BigDecimal walletBalance, Instant createdAt) {}
