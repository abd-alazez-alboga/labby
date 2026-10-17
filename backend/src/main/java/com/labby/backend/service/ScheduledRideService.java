package com.labby.backend.service;

import com.labby.backend.dto.RideDto;
import com.labby.backend.dto.ScheduleRideRequestDto;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The rider side of scheduled rides (scheduled-shared-v1 ScheduledRides; UC-R-10/11). */
public interface ScheduledRideService {

  /**
   * Schedules a ride (transition S1): booking validation plus the region's minimum lead; priced
   * without surge (evaluated at execution).
   *
   * @param userId the rider
   * @param request the inputs and the pickup time
   * @return the ride (state {@code scheduled})
   */
  RideDto schedule(UUID userId, ScheduleRideRequestDto request);

  /**
   * The rider's rides still in {@code scheduled}, soonest first, with claim status.
   *
   * @param userId the rider
   * @return the rides
   */
  List<RideDto> upcoming(UUID userId);

  /**
   * Account suspension side effect (M11 USR-06 reading, approved 2026-10-16): the account's
   * scheduled rides as rider are system-cancelled ({@code account_suspended}, free; a claiming
   * driver is told) and its claims as driver are released ({@code account_suspended}, no metric).
   *
   * @param userId the suspended account
   * @param now the moment
   */
  void onAccountSuspended(UUID userId, Instant now);

  /**
   * The rider half of {@link #onAccountSuspended}: the rider's scheduled rides are system-cancelled
   * ({@code account_suspended}, free; a claiming driver is told) — also on a rider-ROLE suspension
   * (review W4, owner ruling 2026-10-17).
   *
   * @param userId the suspended rider
   * @param now the moment
   */
  void cancelScheduledOfRider(UUID userId, Instant now);

  /**
   * Driver-role suspension side effect: the driver's claims are released ({@code
   * account_suspended}, no metric event) and their rides go back to the board.
   *
   * @param driverUserId the suspended driver
   * @param now the moment
   */
  void releaseClaimsOfSuspendedDriver(UUID driverUserId, Instant now);
}
