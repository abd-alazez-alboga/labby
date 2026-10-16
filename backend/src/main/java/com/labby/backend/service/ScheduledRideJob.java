package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Ticks the scheduled-ride clock (RIDE-S3/S4; {@code labby.scheduled.cron}, every 30 s by default).
 */
@Component
@RequiredArgsConstructor
public class ScheduledRideJob {

  private final ScheduledRideClockService scheduledRideClockService;

  /** One clock pass. */
  @Scheduled(cron = "${labby.scheduled.cron}")
  public void run() {
    scheduledRideClockService.processDue();
  }
}
