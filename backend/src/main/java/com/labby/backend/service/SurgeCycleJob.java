package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the surge cycle (PRC-02; {@code labby.surge.cycle-cron}, {@code SURGE_CYCLE_CRON}, every 2
 * minutes by default; {@code -} disables). All logic lives in {@link SurgeService}.
 */
@Component
@RequiredArgsConstructor
public class SurgeCycleJob {

  private final SurgeService surgeService;

  /** One surge cycle. */
  @Scheduled(cron = "${labby.surge.cycle-cron}")
  public void run() {
    surgeService.recompute();
  }
}
