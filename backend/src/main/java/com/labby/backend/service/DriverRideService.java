package com.labby.backend.service;

import com.labby.backend.dto.DriverCancelRequestDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RideOfferDto;
import com.labby.backend.dto.RideSummaryPageDto;
import java.util.Optional;
import java.util.UUID;

/** The driver side of the ride loop (rides-v1.yaml DriverOffers + DriverRides; UC-D-06..10). */
public interface DriverRideService {

  /**
   * The driver's open, unexpired offer.
   *
   * @param userId the driver
   * @return the offer card, or empty
   */
  Optional<RideOfferDto> openOffer(UUID userId);

  /**
   * Accepts the open offer (transition 5).
   *
   * @param userId the driver
   * @param offerId the offer
   * @return the accepted ride (driver view)
   */
  RideDto accept(UUID userId, UUID offerId);

  /**
   * Declines the open offer; dispatch moves on within a second.
   *
   * @param userId the driver
   * @param offerId the offer
   */
  void decline(UUID userId, UUID offerId);

  /**
   * The ride that still needs the driver (assigned, or completed with cash pending).
   *
   * @param userId the driver
   * @return the ride, or empty
   */
  Optional<RideDto> active(UUID userId);

  /**
   * One of the driver's rides.
   *
   * @param userId the driver
   * @param rideId the ride
   * @return the ride (driver view)
   */
  RideDto get(UUID userId, UUID rideId);

  /**
   * The driver's history, newest first.
   *
   * @param userId the driver
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  RideSummaryPageDto history(UUID userId, int page, int size);

  /**
   * Arrived at pickup (transition 7) — 100 m geofence on the latest fresh position.
   *
   * @param userId the driver
   * @param rideId the ride
   * @return the ride
   */
  RideDto arrive(UUID userId, UUID rideId);

  /**
   * Starts the ride (transition 8).
   *
   * @param userId the driver
   * @param rideId the ride
   * @return the ride
   */
  RideDto start(UUID userId, UUID rideId);

  /**
   * Ends the ride (transition 9): metered fare computed from the trace and stored.
   *
   * @param userId the driver
   * @param rideId the ride
   * @return the completed ride with its fare
   */
  RideDto complete(UUID userId, UUID rideId);

  /**
   * Cash collected (UC-D-09).
   *
   * @param userId the driver
   * @param rideId the ride
   * @return the ride
   */
  RideDto confirmCash(UUID userId, UUID rideId);

  /**
   * Rider did not pay (UC-D-09 E1); the ride stays completed.
   *
   * @param userId the driver
   * @param rideId the ride
   * @param note optional note
   * @return the ride
   */
  RideDto markUnpaid(UUID userId, UUID rideId, String note);

  /**
   * Driver cancels (transition 11): reason mandatory; the rider is re-dispatched on a new linked
   * ride unless the reason is a no-show.
   *
   * @param userId the driver
   * @param rideId the ride
   * @param request the reason (+ note)
   * @return the cancelled ride (driver view)
   */
  RideDto cancel(UUID userId, UUID rideId, DriverCancelRequestDto request);
}
