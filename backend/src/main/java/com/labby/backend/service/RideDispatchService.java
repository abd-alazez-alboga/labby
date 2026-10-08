package com.labby.backend.service;

import java.util.UUID;

/**
 * The sequential dispatch engine (RIDE-03, RIDE-08). Database-driven, no instance-local timers
 * (NFR-P4): a one-second tick finds the rides that need a step — new, declined, expired offer, past
 * give-up — and advances each in its own transaction under a skip-locked row lock, so several
 * instances can tick at once.
 */
public interface RideDispatchService {

  /**
   * Advances every ride that is due now.
   *
   * @return how many rides were advanced
   */
  int dispatchDue();

  /**
   * Advances one ride: times out an expired offer, gives up after the limit or with no candidate
   * left ({@code no_driver_found}), else opens the next offer.
   *
   * @param rideId the ride
   * @return true when the ride changed
   */
  boolean advance(UUID rideId);
}
