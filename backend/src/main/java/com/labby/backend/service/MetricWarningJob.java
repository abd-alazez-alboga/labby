package com.labby.backend.service;

import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the periodic DRV-07 evaluation on {@code labby.trust.metric-warning-cron} ({@code
 * TRUST_METRIC_WARNING_CRON}): every candidate driver is evaluated in its own transaction, so one
 * failure never blocks the others. {@code -} disables the trigger.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MetricWarningJob {

  private final DriverPerformanceService driverPerformanceService;

  /** One evaluation pass over the candidate drivers. */
  @Scheduled(cron = "${labby.trust.metric-warning-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    int raised = 0;
    for (UUID driverUserId : driverPerformanceService.warningCandidates()) {
      try {
        raised += driverPerformanceService.evaluateWarnings(driverUserId);
      } catch (RuntimeException ex) {
        log.warn("Metric warning evaluation failed for driver {}", driverUserId, ex);
      }
    }
    if (raised > 0) {
      log.info("Driver metric warnings raised: {}", raised);
    }
  }
}
