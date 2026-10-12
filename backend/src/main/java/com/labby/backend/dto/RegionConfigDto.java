package com.labby.backend.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The client-facing slice of an ACTIVE region (SD-01), cached by the apps: currency, emergency
 * number, the PRC-03 wait-charge values (M8 — the rider app displays accrual with them; null = the
 * SRS defaults 5 / 0.25) and ENABLED service types only.
 */
public record RegionConfigDto(
    UUID id,
    String name,
    String currency,
    String emergencyNumber,
    Integer waitGraceMin,
    BigDecimal waitPerMinRate,
    List<ServiceTypeDto> serviceTypes) {}
