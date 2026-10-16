package com.labby.backend.service;

/**
 * The scheduled-ride clock (scheduled-shared-v1 "Clock job"): reminders, conversion of claimed
 * rides and fallback of unclaimed ones at T − lead, and the rider-busy cancellation.
 */
public interface ScheduledRideClockService {

  /**
   * One pass over the due rides, one transaction per ride (restart-safe: every effect is keyed to a
   * mark written in the same transaction as its notification).
   *
   * @return how many rides changed
   */
  int processDue();
}
