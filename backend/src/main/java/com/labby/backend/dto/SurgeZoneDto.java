package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * An admin-drawn surge zone (PRC-02, UC-A-08). The override fields reflect the UC-A-09 manual
 * override (null = automatic); the live multipliers are in the region's surge state.
 */
public record SurgeZoneDto(
    UUID id,
    UUID regionId,
    String name,
    GeoJsonPolygonDto polygon,
    List<ThresholdStepDto> thresholdSteps,
    BigDecimal multiplierCap,
    BigDecimal overrideMultiplier,
    OffsetDateTime overrideSetAt) {}
