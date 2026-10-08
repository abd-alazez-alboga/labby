package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Ticks the ride monitor (TRK-02/04; {@code labby.rides.monitor-cron}, every 5 s by default). */
@Component
@RequiredArgsConstructor
public class RideMonitorJob {

  private final RideTrackingService rideTrackingService;

  /** One monitor pass. */
  @Scheduled(cron = "${labby.rides.monitor-cron}")
  public void run() {
    rideTrackingService.monitor();
  }
}
