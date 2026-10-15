package com.labby.backend.controller;

import com.labby.backend.dto.DriverPerformanceDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverPerformanceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The driver performance dashboard (trust-v1.yaml Performance: DRV-06/07, UC-D-20). */
@RestController
@Tag(name = "Performance", description = "Driver metrics, warnings and the rating rule")
@RequiredArgsConstructor
public class DriverPerformanceController {

  private final DriverPerformanceService driverPerformanceService;

  /**
   * The dashboard: 7/30-day metrics, the lifetime snapshot rating, active warnings and the region's
   * rating rule.
   *
   * @return 200 with the dashboard; 403 not an approved driver
   */
  @GetMapping("/api/v1/driver/performance")
  @Operation(summary = "Driver performance dashboard (UC-D-20)")
  public ResponseEntity<DriverPerformanceDto> dashboard() {
    return ResponseEntity.ok(driverPerformanceService.dashboard(SecurityUtils.currentUserId()));
  }
}
