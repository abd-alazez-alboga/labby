package com.labby.backend.dto;

import java.math.BigDecimal;
import java.util.UUID;

/** A region's bookable service type with its pricing (PRC-01, UC-A-07). */
public record ServiceTypeDto(
    UUID id,
    UUID regionId,
    String nameEn,
    String nameAr,
    BigDecimal baseFare,
    BigDecimal perKmRate,
    BigDecimal perMinRate,
    BigDecimal minimumFare,
    boolean enabled) {}
