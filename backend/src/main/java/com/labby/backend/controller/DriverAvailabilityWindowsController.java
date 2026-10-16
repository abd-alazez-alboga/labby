package com.labby.backend.controller;

import com.labby.backend.dto.AvailabilityWindowsDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AvailabilityWindowService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The driver's weekly availability windows (DRV-05, UC-D-05) per scheduled-shared-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/availability-windows")
@Tag(name = "Availability", description = "Weekly availability windows gating the claim board")
@RequiredArgsConstructor
public class DriverAvailabilityWindowsController {

  private final AvailabilityWindowService availabilityWindowService;

  /**
   * The current weekly set.
   *
   * @return 200 with the windows
   */
  @GetMapping
  @Operation(summary = "The driver's weekly availability windows")
  public ResponseEntity<AvailabilityWindowsDto> get() {
    return ResponseEntity.ok(availabilityWindowService.get(SecurityUtils.currentUserId()));
  }

  /**
   * Replaces the whole weekly set.
   *
   * @param request the new set (empty clears it)
   * @return 200 with the stored set; 400 bad times or a duplicate window
   */
  @PutMapping
  @Operation(summary = "Replace the whole weekly set (UC-D-05)")
  public ResponseEntity<AvailabilityWindowsDto> replace(
      @Valid @RequestBody AvailabilityWindowsDto request) {
    return ResponseEntity.ok(
        availabilityWindowService.replace(SecurityUtils.currentUserId(), request));
  }
}
