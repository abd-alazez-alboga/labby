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
   * The rider's history, newest first.
   *
   * @param userId the rider
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  RideSummaryPageDto history(UUID userId, int page, int size);

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
   * One-tap retry of a {@code no_driver_found} ride (RIDE-08): a new, re-priced ride.
   *
   * @param userId the rider
   * @param rideId the ride that found no driver
   * @return the new ride
   */
  RideDto retry(UUID userId, UUID rideId);

  /**
   * Receipt of a completed ride (UC-R-07), from stored components.
   *
   * @param userId the rider
   * @param rideId the ride
   * @return the receipt
   */
  ReceiptDto receipt(UUID userId, UUID rideId);
}
