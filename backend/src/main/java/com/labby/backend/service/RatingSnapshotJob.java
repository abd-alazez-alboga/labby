package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the daily RATE-02 snapshot rewrite on {@code labby.trust.rating-snapshot-cron} ({@code
 * TRUST_RATING_SNAPSHOT_CRON}) in the operating timezone. All logic lives in {@link
 * RatingService#refreshSnapshots}; {@code -} disables the trigger.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RatingSnapshotJob {

  private final RatingService ratingService;

  /** Rewrites every snapshot once. */
  @Scheduled(cron = "${labby.trust.rating-snapshot-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    int written = ratingService.refreshSnapshots();
    log.info("Rating snapshots rewritten: {}", written);
  }
}
