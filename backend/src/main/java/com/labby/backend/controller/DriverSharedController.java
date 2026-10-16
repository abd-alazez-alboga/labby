package com.labby.backend.controller;

import com.labby.backend.dto.RideDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SharedRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The driver's per-member actions on a shared ride (UC-D-13) per scheduled-shared-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/rides/{rideId}/members/{memberId}")
@Tag(name = "DriverShared", description = "Per-member no-show on a shared ride")
@RequiredArgsConstructor
public class DriverSharedController {

  private final SharedRideService sharedRideService;

  /**
   * Marks a member absent at pickup.
   *
   * @param rideId the ride
   * @param memberId the member
   * @return 200 with the driver view; 409 illegal_state / wait_grace_running
   */
  @PostMapping("/no-show")
  @Operation(summary = "Mark a member absent at pickup (UC-D-13 E1)")
  public ResponseEntity<RideDto> noShow(@PathVariable UUID rideId, @PathVariable UUID memberId) {
    return ResponseEntity.ok(
        sharedRideService.markNoShow(SecurityUtils.currentUserId(), rideId, memberId));
  }
}
