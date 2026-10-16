package com.labby.backend.service;

import com.labby.backend.dto.CancellationQuoteDto;
import com.labby.backend.dto.CreateSharedRideRequestDto;
import com.labby.backend.dto.JoinSharedRideRequestDto;
import com.labby.backend.dto.LeaveSharedRideRequestDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.RiderCancelRequestDto;
import com.labby.backend.dto.SharedRideDto;
import com.labby.backend.dto.SharedRidePageDto;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Ride;
import java.time.Instant;
import java.util.UUID;

/** Public shared rides (RIDE-P1..5, UC-R-12..15, UC-D-13; scheduled-shared-v1 SharedRides). */
public interface SharedRideService {

  /**
   * Creates a shared ride (P1); the creator is its first member. A party that fills every seat
   * dispatches at once.
   *
   * @param userId the creator
   * @param request the ride
   * @return the ride
   */
  SharedRideDto create(UUID userId, CreateSharedRideRequestDto request);

  /**
   * Browses gathering rides of the region containing a point (UC-R-13 step 1).
   *
   * @param userId the rider
   * @param criteria the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  SharedRidePageDto browse(UUID userId, BrowseCriteria criteria, int page, int size);

  /**
   * One shared ride: any rider while gathering, its members afterwards.
   *
   * @param userId the rider
   * @param rideId the ride
   * @return the ride
   */
  SharedRideDto get(UUID userId, UUID rideId);

  /**
   * Joins, first-come, under the ride lock (the last-seat race has one winner).
   *
   * @param userId the joiner
   * @param rideId the ride
   * @param request party size and payment method
   * @return the ride
   */
  SharedRideDto join(UUID userId, UUID rideId, JoinSharedRideRequestDto request);

  /**
   * What leaving costs now (free before dispatch, RIDE-07 after).
   *
   * @param userId the member
   * @param rideId the ride
   * @return the quote
   */
  CancellationQuoteDto leaveQuote(UUID userId, UUID rideId);

  /**
   * Leaves: before dispatch free (seats freed); after dispatch a member cancellation (RIDE-07).
   *
   * @param userId the member
   * @param rideId the ride
   * @param request the reason (after dispatch)
   * @return the ride
   */
  SharedRideDto leave(UUID userId, UUID rideId, LeaveSharedRideRequestDto request);

  /**
   * The creator starts now (P2, trigger {@code creator}).
   *
   * @param userId the creator
   * @param rideId the ride
   * @return the ride
   */
  SharedRideDto start(UUID userId, UUID rideId);

  /**
   * The creator cancels the group before dispatch (P3); every member is told.
   *
   * @param userId the creator
   * @param rideId the ride
   * @param request the reason
   * @return the ride
   */
  SharedRideDto cancel(UUID userId, UUID rideId, RiderCancelRequestDto request);

  /**
   * The driver marks a member absent at pickup (UC-D-13 E1).
   *
   * @param driverUserId the assigned driver
   * @param rideId the ride
   * @param memberId the member
   * @return the driver view
   */
  RideDto markNoShow(UUID driverUserId, UUID rideId, UUID memberId);

  /**
   * The clock's shared work: timed departures and "when full" expiry.
   *
   * @return how many rides changed
   */
  int processDue();

  /**
   * RIDE-P4 at completion: divides the stored fare over the boarded seats, completes the boarded
   * members with their share (payment pending until collected) and records the split.
   *
   * @param ride the completing ride (locked)
   * @param fare its stored fare
   */
  void settleSplit(Ride ride, Fare fare);

  /**
   * A driver cancellation re-dispatches a NEW ride (owner 2026-10-07): the group moves with it.
   *
   * @param cancelled the cancelled ride
   * @param redispatched the new ride
   * @param now the moment
   */
  void copyForRedispatch(Ride cancelled, Ride redispatched, Instant now);

  /**
   * Account suspension side effect: the account's memberships still before acceptance end (a
   * gathering ride it created is cancelled for everyone); accepted rides go on.
   *
   * @param userId the suspended account
   * @param now the moment
   */
  void onAccountSuspended(UUID userId, Instant now);

  /**
   * Browse filters.
   *
   * @param lat a point in the region to browse
   * @param lng its longitude
   * @param destLat destination latitude, or null
   * @param destLng destination longitude, or null
   * @param destRadiusM radius around the destination in meters
   * @param departFrom earliest timed departure, or null
   * @param departTo latest timed departure, or null
   */
  record BrowseCriteria(
      double lat,
      double lng,
      Double destLat,
      Double destLng,
      int destRadiusM,
      Instant departFrom,
      Instant departTo) {}
}
