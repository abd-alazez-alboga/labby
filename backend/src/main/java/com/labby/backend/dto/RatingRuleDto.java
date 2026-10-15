package com.labby.backend.dto;

import java.math.BigDecimal;

/** The region's USR-05 / RATE-03 rule for the driver role, shown verbatim (UC-D-20 A1). */
public record RatingRuleDto(BigDecimal minAvgRating, int minRatedRides, BigDecimal warnAvgRating) {}
