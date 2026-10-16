package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import com.labby.backend.repository.RatingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The daily trust pass on {@code labby.trust.rating-snapshot-cron} ({@code
 * TRUST_RATING_SNAPSHOT_CRON}) in the operating timezone: rewrites the RATE-02 snapshots where the
 * refresh rule allows ({@link RatingService#refreshSnapshots}), then evaluates USR-05 / RATE-03 for
 * every rated user x role, each in its own transaction ({@link RatingEvaluationService}) so one
 * failure never blocks the others. {@code -} disables the trigger.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RatingSnapshotJob {

  private final RatingService ratingService;
  private final RatingEvaluationService ratingEvaluationService;

  /** One daily pass. */
  @Scheduled(cron = "${labby.trust.rating-snapshot-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    int written = ratingService.refreshSnapshots();
    int suspended = 0;
    for (RatingRepository.RatedPair pair : ratingEvaluationService.candidates()) {
      try {
        if (ratingEvaluationService.evaluate(
            pair.getUserId(), RideParty.fromValue(pair.getRole()))) {
          suspended++;
        }
      } catch (RuntimeException ex) {
        log.warn("Rating evaluation failed for {} {}", pair.getUserId(), pair.getRole(), ex);
      }
    }
    log.info("Rating snapshots rewritten: {}; low-rating suspensions: {}", written, suspended);
  }
}
