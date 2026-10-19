package com.labby.backend.service;

import java.time.Clock;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The weekly DRV-08 evaluation (incentives-v1 ruling Q3): Mondays, paying the previous week in
 * every region's own zone. Re-runs are harmless (exactly-once awards).
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
