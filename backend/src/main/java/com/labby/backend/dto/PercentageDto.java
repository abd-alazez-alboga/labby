package com.labby.backend.dto;

import java.math.BigDecimal;

/**
 * A DRV-06 rate: {@code percent} (0..100, 1 decimal) is null when the denominator is 0.
 *
 * @param percent the rate
 * @param numerator counted events
 * @param denominator the base
 */
public record PercentageDto(BigDecimal percent, long numerator, long denominator) {}
