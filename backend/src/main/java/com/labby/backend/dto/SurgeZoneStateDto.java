package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One zone's live surge state for the admin (UC-A-09, PRC-02). {@code overridePending}: the last
 * override change (set or reset) is not applied yet — it lands at the next cycle.
 */
public record SurgeZoneStateDto(
    UUID id,
    String name,
    GeoJsonPolygonDto polygon,
    BigDecimal currentMultiplier,
    BigDecimal computedMultiplier,
    BigDecimal overrideMultiplier,
    OffsetDateTime overrideSetAt,
    boolean overridePending,
    int demandCount,
    int supplyCount,
    OffsetDateTime computedAt) {}
