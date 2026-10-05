package com.labby.backend.dto;

import java.util.List;

/**
 * GeoJSON Polygon, SRID 4326 (regions-v1.yaml). Coordinates are {@code [lng, lat]}; the single ring
 * is the outer boundary, closed (first point == last point). Holes are not used in V1 — structural
 * validation lives in {@link com.labby.backend.util.GeoJson}.
 */
public record GeoJsonPolygonDto(String type, List<List<List<Double>>> coordinates) {}
