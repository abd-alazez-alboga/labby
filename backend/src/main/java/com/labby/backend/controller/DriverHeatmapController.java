package com.labby.backend.controller;

import com.labby.backend.dto.HeatmapDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SurgeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The driver's demand heatmap (backend/docs/api/surge-v1.yaml; DRV-09, UC-D-14). */
@RestController
@RequestMapping("/api/v1/driver")
@Tag(name = "DriverHeatmap", description = "Surge zones and their live levels")
@RequiredArgsConstructor
public class DriverHeatmapController {

  private final SurgeService surgeService;

  /**
   * The operating region's surge zones with their current multiplier and level.
   *
   * @return 200 with the heatmap
   */
  @GetMapping("/heatmap")
  @Operation(summary = "Demand heatmap of the operating region (UC-D-14)")
  public ResponseEntity<HeatmapDto> heatmap() {
    return ResponseEntity.ok(surgeService.heatmap(SecurityUtils.currentUserId()));
  }
}
