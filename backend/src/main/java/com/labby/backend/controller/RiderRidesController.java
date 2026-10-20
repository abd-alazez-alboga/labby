package com.labby.backend.controller;

import com.labby.backend.dto.BookRideRequestDto;
import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.EstimateResponseDto;
import com.labby.backend.dto.ReceiptDto;
import com.labby.backend.dto.RetryRideRequestDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.RouteChangeRequestDto;
import com.labby.backend.dto.RouteInputDto;
import com.labby.backend.dto.TipRequestDto;
import com.labby.backend.dto.TipResponseDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.RideMoneyService;
import com.labby.backend.service.RiderRideService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The rider side of the ride loop (rides-v1.yaml RiderRides). */
@RestController
@RequestMapping("/api/v1/rides")
@Tag(name = "RiderRides", description = "Estimate, book, track, cancel, history")
@RequiredArgsConstructor
public class RiderRidesController {

  private final RiderRideService riderRideService;
  private final RideMoneyService rideMoneyService;

  /**
   * Tips the driver from the wallet (PAY-04, UC-R-08).
   *
   * @param rideId the ride
   * @param request the tip amount (ride currency)
   * @return 201 with the applied tip; 409 window expired / already tipped / insufficient balance /
   *     not tippable
   */
  @PostMapping("/{rideId}/tip")
  @Operation(summary = "Tip the driver from the wallet (PAY-04)")
  public ResponseEntity<TipResponseDto> tip(
      @PathVariable UUID rideId, @Valid @RequestBody TipRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(rideMoneyService.tip(SecurityUtils.currentUserId(), rideId, request.amount()));
  }

  /**
   * Estimates every enabled service type (RIDE-01).
   *
   * @param request the route
   * @return 200 with the estimates; 422 outside_region / too_many_stops
   */
  @PostMapping("/estimate")
  @Operation(summary = "Fare estimate per service type (RIDE-01)")
  public ResponseEntity<EstimateResponseDto> estimate(@Valid @RequestBody RouteInputDto request) {
    return ResponseEntity.ok(riderRideService.estimate(SecurityUtils.currentUserId(), request));
  }

  /**
   * Books a ride (UC-R-04).
   *
   * @param request the booking
   * @return 201 with the ride
   */
  @PostMapping
  @Operation(summary = "Book a ride (UC-R-04)")
  public ResponseEntity<RideDto> book(@Valid @RequestBody BookRideRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(riderRideService.book(SecurityUtils.currentUserId(), request));
  }

  /**
   * The rider's history, optionally filtered (V1 conformance W41, UC-R-16).
   *
   * @param page zero-based page
   * @param size page size (1..50)
   * @param state completed | cancelled (optional)
   * @param kind on_demand | scheduled | shared (optional)
   * @param from first day, inclusive (optional, ISO date)
   * @param to last day, inclusive (optional, ISO date)
   * @return 200 with one page
   */
  @GetMapping
  @Operation(summary = "Ride history, newest first, with optional filters")
  public ResponseEntity<RideSummaryPageDto> history(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) String state,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return ResponseEntity.ok(
        riderRideService.history(
            SecurityUtils.currentUserId(),
            Math.max(0, page),
            Math.clamp(size, 1, 50),
            state,
            kind,
            from,
            to));
  }

  /**
   * The rider's active ride.
   *
   * @return 200 with the ride, or 204
   */
  @GetMapping("/active")
  @Operation(summary = "The active ride, or 204")
  public ResponseEntity<RideDto> active() {
    return riderRideService
        .active(SecurityUtils.currentUserId())
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  /**
   * One of the rider's rides.
   *
   * @param rideId the ride
   * @return 200 with the ride
   */
  @GetMapping("/{rideId}")
  @Operation(summary = "One of the rider's rides")
  public ResponseEntity<RideDto> get(@PathVariable UUID rideId) {
    return ResponseEntity.ok(riderRideService.get(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Whether cancelling now is free.
   *
   * @param rideId the ride
   * @return 200 with the quote
   */
  @GetMapping("/{rideId}/cancellation-quote")
  @Operation(summary = "Would cancelling now be free? (RIDE-07)")
  public ResponseEntity<CancellationQuoteDto> cancellationQuote(@PathVariable UUID rideId) {
    return ResponseEntity.ok(
        riderRideService.cancellationQuote(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Rider cancels.
   *
   * @param rideId the ride
   * @param request the reason
   * @return 200 with the cancelled ride
   */
  @PostMapping("/{rideId}/cancel")
  @Operation(summary = "Rider cancels (transition 10)")
  public ResponseEntity<RideDto> cancel(
      @PathVariable UUID rideId, @Valid @RequestBody RiderCancelRequestDto request) {
    return ResponseEntity.ok(
        riderRideService.cancel(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * Changes destination / stops during the ride.
   *
   * @param rideId the ride
   * @param request the new route end
   * @return 200 with the ride
   */
  @PutMapping("/{rideId}/route")
  @Operation(summary = "Change destination / stops (RIDE-05)")
  public ResponseEntity<RideDto> changeRoute(
      @PathVariable UUID rideId, @Valid @RequestBody RouteChangeRequestDto request) {
    return ResponseEntity.ok(
        riderRideService.changeRoute(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * Retries a no_driver_found ride.
   *
   * @param rideId the ride
   * @param request optional: the surge multiplier the rider was shown (omitted body or value = the
   *     previous ride's locked multiplier)
   * @return 201 with the new ride; 409 {@code surge_changed} when the zone's surge moved
   */
  @PostMapping("/{rideId}/retry")
  @Operation(summary = "One-tap retry (RIDE-08)")
  public ResponseEntity<RideDto> retry(
      @PathVariable UUID rideId,
      @Valid @RequestBody(required = false) RetryRideRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            riderRideService.retry(
                SecurityUtils.currentUserId(),
                rideId,
                request == null ? null : request.expectedSurgeMultiplier()));
  }

  /**
   * The receipt of a completed ride.
   *
   * @param rideId the ride
   * @return 200 with the receipt
   */
  @GetMapping("/{rideId}/receipt")
  @Operation(summary = "Receipt from stored components (PRC-04)")
  public ResponseEntity<ReceiptDto> receipt(@PathVariable UUID rideId) {
    return ResponseEntity.ok(riderRideService.receipt(SecurityUtils.currentUserId(), rideId));
  }
}
