package com.labby.backend.service;

import com.labby.backend.dto.ClaimBoardPageDto;
import com.labby.backend.dto.ClaimReleaseRequestDto;
import com.labby.backend.dto.RideDto;
import java.util.List;
import java.util.UUID;

/** The driver side of scheduled rides (RIDE-S2, UC-D-11/12; scheduled-shared-v1 ClaimBoard). */
public interface ClaimBoardService {

  /**
   * Open scheduled rides the driver may claim, soonest first (empty while the driver is suspended
   * or has no active vehicle).
   *
   * @param driverUserId the driver
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  ClaimBoardPageDto board(UUID driverUserId, int page, int size);

  /**
   * Claims a board entry under the ride lock (one winner; the loser gets {@code already_claimed}).
   *
   * @param driverUserId the driver
   * @param rideId the ride
   * @return the driver view (exact pickup, rider summary)
   */
  RideDto claim(UUID driverUserId, UUID rideId);

  /**
   * Gives a claim back before conversion (UC-D-12 E1); feeds the cancellation metric.
   *
   * @param driverUserId the claiming driver
   * @param rideId the ride
   * @param request the reason
   */
  void release(UUID driverUserId, UUID rideId, ClaimReleaseRequestDto request);

  /**
   * The driver's claims not yet executed, soonest first.
   *
   * @param driverUserId the driver
   * @return the rides (driver view)
   */
  List<RideDto> claims(UUID driverUserId);
}
