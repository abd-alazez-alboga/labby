package com.labby.backend.controller;

import com.labby.backend.dto.IncentiveProgressDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.IncentiveService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The driver's incentive progress (incentives-v1.yaml DriverIncentives: DRV-08, UC-D-17). */
@RestController
@RequestMapping("/api/v1/driver/incentives")
@Tag(name = "DriverIncentives", description = "Weekly bonuses, peak hours, rating reward")
@RequiredArgsConstructor
public class DriverIncentivesController {

  private final IncentiveService incentiveService;

  /**
   * This week's live progress in a region, plus recent awards.
   *
   * @param regionId the region the app is in
   * @return 200 with the progress
   */
  @GetMapping
  @Operation(summary = "Incentive progress this week (UC-D-17)")
  public ResponseEntity<IncentiveProgressDto> progress(@RequestParam UUID regionId) {
    return ResponseEntity.ok(incentiveService.progress(SecurityUtils.currentUserId(), regionId));
  }
}
