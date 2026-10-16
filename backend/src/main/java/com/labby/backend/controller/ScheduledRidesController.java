package com.labby.backend.controller;

import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.ScheduleRideRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ScheduledRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The rider's scheduled rides (UC-R-10/11) per scheduled-shared-v1.yaml. Cancelling is the rides-v1
 * {@code POST /rides/{id}/cancel} (always free while scheduled).
 */
@RestController
@RequestMapping("/api/v1/scheduled-rides")
@Tag(name = "ScheduledRides", description = "Schedule a ride, upcoming scheduled rides")
@RequiredArgsConstructor
public class ScheduledRidesController {

  private final ScheduledRideService scheduledRideService;

  /**
   * Schedules a ride (transition S1).
   *
   * @param request the booking inputs and pickup time
   * @return 201 with the ride; 422 scheduled_too_soon / outside_region / too_many_stops /
   *     service_type_unavailable
   */
  @PostMapping
  @Operation(summary = "Schedule a ride for a future pickup time (UC-R-10)")
  public ResponseEntity<RideDto> schedule(@Valid @RequestBody ScheduleRideRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(scheduledRideService.schedule(SecurityUtils.currentUserId(), request));
  }

  /**
   * The rider's upcoming scheduled rides with claim status.
   *
   * @return 200 with the rides, soonest first
   */
  @GetMapping
  @Operation(summary = "Upcoming scheduled rides (UC-R-11)")
  public ResponseEntity<List<RideDto>> upcoming() {
    return ResponseEntity.ok(scheduledRideService.upcoming(SecurityUtils.currentUserId()));
  }
}
