package com.labby.backend.controller;

import com.labby.backend.dto.AnalyticsDashboardDto;
import com.labby.backend.service.AnalyticsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The admin analytics dashboard (analytics-v1.yaml AdminAnalytics: ADM-02, UC-A-30). */
@RestController
@RequestMapping("/api/v1/admin/analytics")
@Tag(name = "AdminAnalytics", description = "Dashboard figures")
@RequiredArgsConstructor
public class AdminAnalyticsController {

  private final AnalyticsService analyticsService;

  /**
   * Rides, revenue, users and ops over {@code [from, to)}.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return 200 with the dashboard
   */
  @GetMapping
  @PreAuthorize("hasAuthority('analytics:view')")
  @Operation(summary = "Dashboard figures for the four ADM-02 groups (UC-A-30)")
  public ResponseEntity<AnalyticsDashboardDto> dashboard(
      @RequestParam Instant from,
      @RequestParam Instant to,
      @RequestParam(required = false) UUID regionId) {
    return ResponseEntity.ok(analyticsService.dashboard(from, to, regionId));
  }
}
