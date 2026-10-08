package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Ticks the dispatcher (RIDE-03; {@code labby.rides.dispatch-cron}, every second by default). */
@Component
@RequiredArgsConstructor
public class RideDispatchJob {

  private final RideDispatchService rideDispatchService;

  /** One dispatcher pass. */
  @Scheduled(cron = "${labby.rides.dispatch-cron}")
  public void run() {
    rideDispatchService.dispatchDue();
  }
}
