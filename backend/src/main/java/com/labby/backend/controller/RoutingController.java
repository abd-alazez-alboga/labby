package com.labby.backend.controller;

import com.labby.backend.dto.RouteRequestDto;
import com.labby.backend.dto.RouteResponseDto;
import com.labby.backend.service.RoutingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Route estimates (ES-04, NFR-A3) per realtime-v1.yaml. */
@RestController
@RequestMapping("/api/v1/routing")
@Tag(name = "Routing", description = "Route, distance and duration")
@RequiredArgsConstructor
public class RoutingController {

  private final RoutingService routingService;

  /**
   * Routes through 2..5 points.
   *
   * @param request the points
   * @return 200 with the route (approximate when OSRM was unavailable); 400 for invalid points
   */
  @PostMapping("/route")
  @Operation(summary = "Route, distance and duration through 2..5 points (ES-04, NFR-A3)")
  public ResponseEntity<RouteResponseDto> route(@Valid @RequestBody RouteRequestDto request) {
    return ResponseEntity.ok(routingService.route(request));
  }
}
