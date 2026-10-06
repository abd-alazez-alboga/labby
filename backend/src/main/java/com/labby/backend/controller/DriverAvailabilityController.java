package com.labby.backend.controller;

import com.labby.backend.dto.AvailabilityUpdateDto;
import com.labby.backend.dto.DriverAvailabilityDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverAvailabilityService;
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

/** Driver online/offline (DRV-05, UC-D-04) per realtime-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/availability")
@Tag(name = "DriverAvailability", description = "Online / offline")
@RequiredArgsConstructor
public class DriverAvailabilityController {

  private final DriverAvailabilityService driverAvailabilityService;

  /**
   * Online state and whether the driver may go online.
   *
   * @return 200 with the state; 409 without a driver profile
   */
  @GetMapping
  @Operation(summary = "Online state and whether the driver may go online")
  public ResponseEntity<DriverAvailabilityDto> get() {
    return ResponseEntity.ok(driverAvailabilityService.get(SecurityUtils.currentUserId()));
  }

  /**
   * Goes online or offline (idempotent).
   *
   * @param request the requested state
   * @return 200 with the new state; 409 when a gate refuses
   */
  @PutMapping
  @Operation(summary = "Go online / offline (UC-D-04)")
  public ResponseEntity<DriverAvailabilityDto> set(
      @Valid @RequestBody AvailabilityUpdateDto request) {
    return ResponseEntity.ok(
        driverAvailabilityService.set(SecurityUtils.currentUserId(), request.online()));
  }
}
