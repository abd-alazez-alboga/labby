package com.labby.backend.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One zone on the driver heatmap (DRV-09): its current multiplier and level (0 = no surge, n = the
 * n-th threshold step reached). Raw demand/supply counts are admin-only.
 */
public record HeatmapZoneDto(
    UUID id, String name, GeoJsonPolygonDto polygon, BigDecimal multiplier, int level) {}
