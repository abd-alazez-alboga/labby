package com.labby.backend.service;

import com.labby.backend.dto.RouteRequestDto;
import com.labby.backend.dto.RouteResponseDto;

/** Route estimates for clients (ES-04) through the {@link RoutingProvider} seam. */
public interface RoutingService {

  /**
   * Routes through the request's points in order.
   *
   * @param request 2..5 points
   * @return distance, duration and GeoJSON geometry; approximate when OSRM was unavailable
   */
  RouteResponseDto route(RouteRequestDto request);
}
