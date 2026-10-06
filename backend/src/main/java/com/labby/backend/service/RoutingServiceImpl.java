package com.labby.backend.service;

import com.labby.backend.dto.LineStringDto;
import com.labby.backend.dto.RouteDto;
import com.labby.backend.dto.RouteRequestDto;
import com.labby.backend.dto.RouteResponseDto;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** Shapes the provider's route as the contract's {@code Route} (GeoJSON LineString). */
@Service
@RequiredArgsConstructor
public class RoutingServiceImpl implements RoutingService {

  private final RoutingProvider routingProvider;

  @Override
  public RouteResponseDto route(RouteRequestDto request) {
    RouteDto route = routingProvider.route(request.points());
    return new RouteResponseDto(
        route.distanceMeters(),
        route.durationSeconds(),
        LineStringDto.of(route.geometry()),
        route.approximate());
  }
}
