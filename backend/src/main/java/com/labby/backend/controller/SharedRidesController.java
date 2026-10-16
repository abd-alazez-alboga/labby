package com.labby.backend.controller;

import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.CreateSharedRideRequestDto;
import com.labby.backend.dto.JoinSharedRideRequestDto;
import com.labby.backend.dto.LeaveSharedRideRequestDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.SharedRideDto;
import com.labby.backend.dto.SharedRidePageDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SharedRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public shared rides (UC-R-12..15) per scheduled-shared-v1.yaml. */
@RestController
@RequestMapping("/api/v1/shared-rides")
@Tag(name = "SharedRides", description = "Create, browse, join, leave, start, cancel")
@RequiredArgsConstructor
public class SharedRidesController {

  private final SharedRideService sharedRideService;

  /**
   * Creates a shared ride (P1).
   *
   * @param request the ride
   * @return 201 with the ride; 409 active_ride_exists; 422 seats_unavailable / party_too_large /
   *     departure_in_past / outside_region / service_type_unavailable
   */
  @PostMapping
  @Operation(summary = "Create a public shared ride (UC-R-12)")
  public ResponseEntity<SharedRideDto> create(
      @Valid @RequestBody CreateSharedRideRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(sharedRideService.create(SecurityUtils.currentUserId(), request));
  }

  /**
   * Browses open shared rides of the region containing a point.
   *
   * @return 200 with one page; 422 outside_region
   */
  @GetMapping
  @Operation(summary = "Browse open shared rides (UC-R-13)")
  public ResponseEntity<SharedRidePageDto> browse(
      @RequestParam double lat,
      @RequestParam double lng,
      @RequestParam(required = false) Double destLat,
      @RequestParam(required = false) Double destLng,
      @RequestParam(defaultValue = "1000") int destRadiusM,
      @RequestParam(required = false) Instant departFrom,
      @RequestParam(required = false) Instant departTo,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        sharedRideService.browse(
            SecurityUtils.currentUserId(),
            new SharedRideService.BrowseCriteria(
                lat,
                lng,
                destLat,
                destLng,
                Math.clamp(destRadiusM, 100, 20000),
                departFrom,
                departTo),
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /**
   * One shared ride.
   *
   * @param rideId the ride
   * @return 200; 404 unknown or not visible
   */
  @GetMapping("/{rideId}")
  @Operation(summary = "One shared ride")
  public ResponseEntity<SharedRideDto> get(@PathVariable UUID rideId) {
    return ResponseEntity.ok(sharedRideService.get(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Joins, first-come.
   *
   * @param rideId the ride
   * @param request party size and payment method
   * @return 200; 409 insufficient_seats / shared_ride_closed / already_member / active_ride_exists
   */
  @PostMapping("/{rideId}/join")
  @Operation(summary = "Join a shared ride (UC-R-13)")
  public ResponseEntity<SharedRideDto> join(
      @PathVariable UUID rideId, @Valid @RequestBody JoinSharedRideRequestDto request) {
    return ResponseEntity.ok(
        sharedRideService.join(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * What leaving costs now.
   *
   * @param rideId the ride
   * @return 200 with the quote
   */
  @GetMapping("/{rideId}/leave-quote")
  @Operation(summary = "What leaving costs right now")
  public ResponseEntity<CancellationQuoteDto> leaveQuote(@PathVariable UUID rideId) {
    return ResponseEntity.ok(sharedRideService.leaveQuote(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Leaves (before dispatch free, after it a member cancellation).
   *
   * @param rideId the ride
   * @param request the reason (after dispatch)
   * @return 200; 409 creator_must_cancel / illegal_state
   */
  @PostMapping("/{rideId}/leave")
  @Operation(summary = "Leave a shared ride (UC-R-14)")
  public ResponseEntity<SharedRideDto> leave(
      @PathVariable UUID rideId,
      @Valid @RequestBody(required = false) LeaveSharedRideRequestDto request) {
    return ResponseEntity.ok(
        sharedRideService.leave(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * The creator starts now.
   *
   * @param rideId the ride
   * @return 200; 403 not the creator; 409 illegal_state
   */
  @PostMapping("/{rideId}/start")
  @Operation(summary = "Creator starts now (UC-R-15)")
  public ResponseEntity<SharedRideDto> start(@PathVariable UUID rideId) {
    return ResponseEntity.ok(sharedRideService.start(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * The creator cancels the group before dispatch.
   *
   * @param rideId the ride
   * @param request the reason
   * @return 200; 403 not the creator; 409 illegal_state
   */
  @PostMapping("/{rideId}/cancel")
  @Operation(summary = "Creator cancels the group (UC-R-15)")
  public ResponseEntity<SharedRideDto> cancel(
      @PathVariable UUID rideId, @Valid @RequestBody RiderCancelRequestDto request) {
    return ResponseEntity.ok(
        sharedRideService.cancel(SecurityUtils.currentUserId(), rideId, request));
  }
}
