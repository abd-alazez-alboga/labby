package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Ticks the scheduled-ride clock (RIDE-S3/S4) and the shared departures / expiry (RIDE-P3; {@code
 * labby.scheduled.cron}, every 30 s by default).
 */
@Component
@RequiredArgsConstructor
public class ScheduledRideJob {

  private final ScheduledRideClockService scheduledRideClockService;
  private final SharedRideService sharedRideService;

  /** One clock pass: scheduled rides, then shared departures / expiry. */
  @Scheduled(cron = "${labby.scheduled.cron}")
  public void run() {
    scheduledRideClockService.processDue();
    sharedRideService.processDue();
  }
}
