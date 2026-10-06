package com.labby.backend.dto;

import java.util.List;

/**
 * A route from the {@code RoutingProvider} seam (realtime-v1.yaml {@code Route}, ES-04).
 *
 * @param distanceMeters total distance
 * @param durationSeconds total duration
 * @param geometry the path as GeoJSON LineString coordinates, [lng, lat] each
 * @param approximate true when OSRM was unavailable and this is a straight-line estimate (NFR-A3)
 */
public record RouteDto(
    long distanceMeters, long durationSeconds, List<double[]> geometry, boolean approximate) {}
