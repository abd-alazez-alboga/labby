package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * An admin-drawn surge zone (PRC-02, UC-A-08). Override fields belong to the UC-A-09 flow (M9) and
 * stay null until then.
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
