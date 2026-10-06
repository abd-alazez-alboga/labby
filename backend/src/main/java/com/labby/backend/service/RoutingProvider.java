package com.labby.backend.service;

import com.labby.backend.dto.LatLngDto;
import com.labby.backend.dto.RouteDto;
import java.util.List;

/**
 * Routing seam (ES-04). V1 calls the public OSRM demo server; migrating to self-hosted OSRM (a
 * mandatory pre-launch gate) or a paid provider is a configuration change behind this interface.
 * Implementations must never fail hard on an unreachable backend: they fall back to a straight-line
 * estimate flagged {@link RouteDto#approximate()} (NFR-A3). Used for route estimates (M6), fare
 * estimates and dispatch ETAs (M7).
 */
public interface RoutingProvider {

  /**
   * Routes through the points in order.
   *
   * @param points origin, up to three intermediate stops, destination (2..5 points)
   * @return distance, duration and geometry; approximate when the routing backend was unavailable
   */
  RouteDto route(List<LatLngDto> points);

  /**
   * Driving ETA between two points — the duration of {@link #route} over just these two.
   *
   * @param from origin
   * @param to destination
   * @return seconds; approximate under the same fallback rule
   */
  default long etaSeconds(LatLngDto from, LatLngDto to) {
    return route(List.of(from, to)).durationSeconds();
  }
}
