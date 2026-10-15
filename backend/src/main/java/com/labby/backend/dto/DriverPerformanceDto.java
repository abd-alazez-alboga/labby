package com.labby.backend.dto;

import java.util.List;

/**
 * The driver performance dashboard (UC-D-20, DRV-06/07).
 *
 * @param windows the 7- and 30-day metric windows
 * @param rating the lifetime snapshot average (exposed view — not per window)
 * @param warnings the active DRV-07 warnings
 * @param ratingRule the rule of the driver's region (latest ride), or null before any ride
 * @param ratingWarning the exposed average is below {@code ratingRule.warnAvgRating}
 */
public record DriverPerformanceDto(
    List<MetricWindowDto> windows,
    OwnRatingAggregateDto rating,
    List<MetricWarningDto> warnings,
    RatingRuleDto ratingRule,
    boolean ratingWarning) {}
