package com.labby.backend.dto;

import com.labby.backend.enums.DriverMetric;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * An ACTIVE DRV-07 warning with the rule that raised it (UC-D-20).
 *
 * @param metric acceptance or cancellation
 * @param valuePercent the metric when raised
 * @param thresholdPercent the region's threshold
 * @param comparison {@code below} (acceptance) or {@code above} (cancellation)
 * @param windowDays the evaluation window
 * @param sampleSize offers (acceptance) / accepted rides (cancellation) evaluated
 * @param raisedAt when raised
 */
public record MetricWarningDto(
    DriverMetric metric,
    BigDecimal valuePercent,
    BigDecimal thresholdPercent,
    String comparison,
    int windowDays,
    int sampleSize,
    Instant raisedAt) {}
