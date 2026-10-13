package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import java.math.BigDecimal;

/**
 * Optional retry payload (RIDE-08, PRC-02): {@code expectedSurgeMultiplier} is the multiplier the
 * rider was shown — after a 409 {@code surge_changed}, the new value they confirmed. Omitted, the
 * previous ride's locked multiplier is expected, so a retry never locks a surge the rider has not
 * seen. Same bounds as booking: at least 1.00, at most 2 decimals.
 */
public record RetryRideRequestDto(
    @DecimalMin("1.00") @Digits(integer = 2, fraction = 2) BigDecimal expectedSurgeMultiplier) {}
