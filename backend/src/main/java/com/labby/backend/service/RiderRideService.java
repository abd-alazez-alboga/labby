package com.labby.backend.service;

import com.labby.backend.dto.BookRideRequestDto;
import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.EstimateResponseDto;
import com.labby.backend.dto.ReceiptDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideSummaryPageDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.RouteChangeRequestDto;
import com.labby.backend.dto.RouteInputDto;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** The rider side of the ride loop (rides-v1.yaml RiderRides; UC-R-04..07/09, RIDE-08). */
public interface RiderRideService {

  /**
   * Estimates every enabled service type of the pickup's region (RIDE-01).
   *
   * @param userId the rider
   * @param request the route
   * @return the estimates
   */
  EstimateResponseDto estimate(UUID userId, RouteInputDto request);

  /**
   * Books a ride (UC-R-04): validated, priced server-side, locked surcharge/surge, {@code
   * requested}; dispatch picks it up within a second.
   *
   * @param userId the rider
   * @param request the booking
   * @return the ride (rider view)
   */
  RideDto book(UUID userId, BookRideRequestDto request);

  /**
   * The rider's active ride.
   *
   * @param userId the rider
   * @return the ride, or empty
   */
  Optional<RideDto> active(UUID userId);

  /**
   * One of the rider's rides.
   *
   * @param userId the rider
   * @param rideId the ride
   * @return the ride (rider view)
   */
  RideDto get(UUID userId, UUID rideId);

  /**
   * The rider's history, newest first, optionally filtered (V1 conformance W41, UC-R-16).
   *
   * @param userId the rider
   * @param page zero-based page
   * @param size page size
   * @param state {@code completed} | {@code cancelled} (cancelled by rider / driver, no driver
   *     found), or null for any
   * @param kind {@code on_demand} | {@code scheduled} | {@code shared}, or null for any
   * @param from first day (inclusive, the ride region's local day), or null
   * @param to last day (inclusive, the ride region's local day), or null
   * @return one page
   * @throws com.labby.backend.exception.InvalidRequestException an unknown state / kind, or from
   *     after to
   */
  RideSummaryPageDto history(
      UUID userId, int page, int size, String state, String kind, LocalDate from, LocalDate to);

  /**
   * What cancelling now would cost (RIDE-07 grace indication).
   *
   * @param userId the rider
   * @param rideId the ride
   * @return the quote
   */
  CancellationQuoteDto cancellationQuote(UUID userId, UUID rideId);

  /**
   * Rider cancels (transition 10).
   *
   * @param userId the rider
   * @param rideId the ride
   * @param request reason (+ note for other)
   * @return the cancelled ride
   */
  RideDto cancel(UUID userId, UUID rideId, RiderCancelRequestDto request);

  /**
   * Replaces destination and stops during the ride (RIDE-05).
   *
   * @param userId the rider
   * @param rideId the ride
   * @param request the new route end
   * @return the updated ride
   */
  RideDto changeRoute(UUID userId, UUID rideId, RouteChangeRequestDto request);

  /**
   * One-tap retry of a {@code no_driver_found} ride (RIDE-08): a new, re-priced ride. The surge
   * must still be the one the rider saw (PRC-02): when the pickup zone's current multiplier differs
   * from the expectation → 409 {@code surge_changed} with {@code details.surgeMultiplier}.
   *
   * @param userId the rider
   * @param rideId the ride that found no driver
   * @param expectedSurgeMultiplier the multiplier the rider confirmed, or null = the previous
   *     ride's locked multiplier
   * @return the new ride
   */
  RideDto retry(UUID userId, UUID rideId, BigDecimal expectedSurgeMultiplier);

  /**
   * Receipt of a completed ride (UC-R-07), from stored components.
   *
   * @param userId the rider
   * @param rideId the ride
   * @return the receipt
   */
  ReceiptDto receipt(UUID userId, UUID rideId);
}
