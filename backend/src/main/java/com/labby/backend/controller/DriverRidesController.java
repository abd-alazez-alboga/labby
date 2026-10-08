package com.labby.backend.controller;

import com.labby.backend.dto.DriverCancelRequestDto;
import com.labby.backend.dto.MarkUnpaidRequestDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The driver's ride lifecycle (UC-D-07..10) per rides-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/rides")
@Tag(name = "DriverRides", description = "Arrive, start, complete, cash, cancel, history")
@RequiredArgsConstructor
public class DriverRidesController {

  private final DriverRideService driverRideService;

  /**
   * The ride that still needs the driver.
   *
   * @return 200 with the ride, or 204
   */
  @GetMapping("/active")
  @Operation(summary = "The active ride (or completed with cash pending), or 204")
  public ResponseEntity<RideDto> active() {
    return driverRideService
        .active(SecurityUtils.currentUserId())
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  /**
   * The driver's history.
   *
   * @param page zero-based page
   * @param size page size (1..50)
   * @return 200 with one page
   */
  @GetMapping
  @Operation(summary = "Ride history, newest first")
  public ResponseEntity<RideSummaryPageDto> history(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        driverRideService.history(
            SecurityUtils.currentUserId(), Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * One of the driver's rides.
   *
   * @param rideId the ride
   * @return 200 with the ride
   */
  @GetMapping("/{rideId}")
  @Operation(summary = "One of the driver's rides")
  public ResponseEntity<RideDto> get(@PathVariable UUID rideId) {
    return ResponseEntity.ok(driverRideService.get(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Arrived at pickup.
   *
   * @param rideId the ride
   * @return 200; 422 outside_geofence / no_position
   */
  @PostMapping("/{rideId}/arrive")
  @Operation(summary = "Arrived at pickup (100 m geofence)")
  public ResponseEntity<RideDto> arrive(@PathVariable UUID rideId) {
    return ResponseEntity.ok(driverRideService.arrive(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Starts the ride.
   *
   * @param rideId the ride
   * @return 200
   */
  @PostMapping("/{rideId}/start")
  @Operation(summary = "Start the ride")
  public ResponseEntity<RideDto> start(@PathVariable UUID rideId) {
    return ResponseEntity.ok(driverRideService.start(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Ends the ride; the metered fare is stored.
   *
   * @param rideId the ride
   * @return 200 with the fare
   */
  @PostMapping("/{rideId}/complete")
  @Operation(summary = "End the ride — metered fare stored")
  public ResponseEntity<RideDto> complete(@PathVariable UUID rideId) {
    return ResponseEntity.ok(driverRideService.complete(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Cash collected.
   *
   * @param rideId the ride
   * @return 200
   */
  @PostMapping("/{rideId}/cash-confirm")
  @Operation(summary = "Cash collected")
  public ResponseEntity<RideDto> confirmCash(@PathVariable UUID rideId) {
    return ResponseEntity.ok(driverRideService.confirmCash(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * The rider did not pay.
   *
   * @param rideId the ride
   * @param request optional note
   * @return 200
   */
  @PostMapping("/{rideId}/mark-unpaid")
  @Operation(summary = "Rider did not pay (the ride stays completed)")
  public ResponseEntity<RideDto> markUnpaid(
      @PathVariable UUID rideId,
      @Valid @RequestBody(required = false) MarkUnpaidRequestDto request) {
    return ResponseEntity.ok(
        driverRideService.markUnpaid(
            SecurityUtils.currentUserId(), rideId, request == null ? null : request.note()));
  }

  /**
   * Driver cancels.
   *
   * @param rideId the ride
   * @param request the reason
   * @return 200 with the cancelled ride
   */
  @PostMapping("/{rideId}/cancel")
  @Operation(summary = "Driver cancels (transition 11)")
  public ResponseEntity<RideDto> cancel(
      @PathVariable UUID rideId, @Valid @RequestBody DriverCancelRequestDto request) {
    return ResponseEntity.ok(
        driverRideService.cancel(SecurityUtils.currentUserId(), rideId, request));
  }
}
