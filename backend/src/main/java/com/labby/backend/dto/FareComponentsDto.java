package com.labby.backend.dto;

import java.math.BigDecimal;

/** Money components of an estimate or a stored fare (PRC-04). */
public record FareComponentsDto(
    String currency,
    BigDecimal baseFare,
    BigDecimal distanceFare,
    BigDecimal timeFare,
    BigDecimal surchargePercent,
    BigDecimal surchargeAmount,
    BigDecimal surgeMultiplier,
    BigDecimal surgeAmount,
    BigDecimal waitFare,
    BigDecimal pickupFee,
    BigDecimal minimumFareAdjustment,
    BigDecimal discount,
    BigDecimal total) {}
