package com.labby.backend.dto;

/** The routed path an estimate is based on ([lng, lat] geometry). */
public record RouteSummaryDto(
    long distanceMeters,
    long durationSeconds,
    boolean approximate,
    GeoJsonLineStringDto geometry) {}
