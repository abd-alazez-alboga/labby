package com.labby.backend.dto;

import java.math.BigDecimal;

/** The pickup-distance fee a far driver would add (UC-R-04 A3). */
public record PickupFeeRuleDto(BigDecimal thresholdKm, BigDecimal perKm) {}
