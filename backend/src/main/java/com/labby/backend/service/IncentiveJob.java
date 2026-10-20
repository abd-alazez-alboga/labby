package com.labby.backend.service;

import java.time.Clock;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The DRV-08 evaluation (incentives-v1 ruling Q3, amended by review W1): every tick (default
 * hourly) pays each region's last finished week in its own zone. Re-runs are harmless (exactly-once
 * awards), so a region is paid in the first tick after its own Monday starts and a missed tick is
 * caught up by the next.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IncentiveJob {

  private final IncentiveService incentiveService;
  private final Clock clock;

  /** Runs on {@code labby.incentives.cron} in the operating zone ("-" disables). */
  @Scheduled(cron = "${labby.incentives.cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    int paid = incentiveService.evaluatePreviousWeek(clock.instant());
    log.info("Incentive evaluation paid {} award(s)", paid);
  }
}
