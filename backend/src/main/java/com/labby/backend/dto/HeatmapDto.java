package com.labby.backend.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The driver's demand heatmap (DRV-09, UC-D-14): the zones of their operating region as of the
 * latest surge cycle ({@code computedAt}, null before the first one) and when the next cycle runs
 * (null when the cycle is disabled) — the client refreshes then.
 */
public record HeatmapDto(
    UUID regionId,
    OffsetDateTime computedAt,
    OffsetDateTime nextCycleAt,
    List<HeatmapZoneDto> zones) {}
