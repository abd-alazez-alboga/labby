package com.labby.backend.dto;

/**
 * A route (realtime-v1.yaml {@code Route}, ES-04, NFR-A3).
 *
 * @param distanceMeters total distance
 * @param durationSeconds total duration
 * @param geometry the path as a GeoJSON LineString (straight segments when approximate)
 * @param approximate true when OSRM was unavailable and this is a straight-line estimate
 */
public record RouteResponseDto(
    long distanceMeters, long durationSeconds, LineStringDto geometry, boolean approximate) {}
