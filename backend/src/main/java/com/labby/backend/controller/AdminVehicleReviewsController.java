package com.labby.backend.controller;

import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.VehicleReviewDto;
import com.labby.backend.dto.VehicleReviewSummaryDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverVehicleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Vehicle-switch review (UC-A-11) per onboarding-v1.yaml; reads need {@code driver-review:view},
 * decisions {@code driver-review:decide} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin/vehicle-reviews")
@Tag(name = "AdminVehicleReviews", description = "Vehicle-switch review (UC-A-11)")
@RequiredArgsConstructor
public class AdminVehicleReviewsController {

  private final DriverVehicleService driverVehicleService;

  /**
   * The vehicle-switch queue, oldest first.
   *
   * @return 200 with the queue
   */
  @GetMapping
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Vehicle-switch queue")
  public ResponseEntity<List<VehicleReviewSummaryDto>> listSwitches() {
    return ResponseEntity.ok(driverVehicleService.listSwitchQueue());
  }

  /**
   * One switch beside the current active vehicle (fresh file URLs).
   *
   * @param vehicleId the switch vehicle
   * @return 200 with the switch
   */
  @GetMapping("/{vehicleId}")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Switch detail")
  public ResponseEntity<VehicleReviewDto> getSwitch(@PathVariable UUID vehicleId) {
    return ResponseEntity.ok(driverVehicleService.getSwitch(vehicleId));
  }

  /**
   * Approves the switch; the new vehicle becomes the single active one.
   *
   * @param vehicleId the switch vehicle
   * @param request the service types
   * @return 200 with the switch
   */
  @PostMapping("/{vehicleId}/approve")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Approve the switch")
  public ResponseEntity<VehicleReviewDto> approveSwitch(
      @PathVariable UUID vehicleId, @Valid @RequestBody ApproveRequestDto request) {
    return ResponseEntity.ok(
        driverVehicleService.approveSwitch(SecurityUtils.currentUserId(), vehicleId, request));
  }

  /**
   * Rejects the switch; the driver keeps the current vehicle.
   *
   * @param vehicleId the switch vehicle
   * @param request the reason
   * @return 200 with the switch
   */
  @PostMapping("/{vehicleId}/reject")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Reject the switch")
  public ResponseEntity<VehicleReviewDto> rejectSwitch(
      @PathVariable UUID vehicleId, @Valid @RequestBody ReasonRequestDto request) {
    return ResponseEntity.ok(
        driverVehicleService.rejectSwitch(SecurityUtils.currentUserId(), vehicleId, request));
  }
}
