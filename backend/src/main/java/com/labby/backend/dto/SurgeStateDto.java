package com.labby.backend.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * A region's live surge state (UC-A-09): the region cap, when the next cycle runs (null when the
 * cycle is disabled) and every zone's state, name-sorted.
 */
public record SurgeStateDto(
    UUID regionId,
    BigDecimal surgeCap,
    OffsetDateTime nextCycleAt,
    List<SurgeZoneStateDto> zones) {}
