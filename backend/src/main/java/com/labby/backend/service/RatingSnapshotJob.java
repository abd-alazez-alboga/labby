package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import com.labby.backend.repository.RatingRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The daily trust pass on {@code labby.trust.rating-snapshot-cron} ({@code
 * TRUST_RATING_SNAPSHOT_CRON}) in the operating timezone: rewrites the RATE-02 snapshots where the
 * refresh rule allows ({@link RatingService#refreshSnapshots}), then evaluates USR-05 / RATE-03 for
 * every rated user x role, each in its own transaction ({@link RatingEvaluationService}) so one
 * failure never blocks the others. V1 conformance H5 (owner ruling 2026-10-20): the same pass
 * rewrites the incentives' weekly rating snapshots ({@link
 * IncentiveService#refreshRatingSnapshots}) and evaluates the 5-star ratings stored since the last
 * pass for the 5-star week badge and rating challenges ({@link GrowthService#evaluateRating}), so
 * none of them moves right after a given ride. {@code -} disables the trigger.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RatingSnapshotJob {

  private final RatingService ratingService;
  private final RatingEvaluationService ratingEvaluationService;
  private final IncentiveService incentiveService;
  private final GrowthService growthService;
  private final Clock clock;

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
    Instant now = clock.instant();
    int weekly = incentiveService.refreshRatingSnapshots(now);
    int grown = 0;
    for (UUID ratingId : growthService.pendingRatingEvaluations()) {
      try {
        growthService.evaluateRating(ratingId, now);
        grown++;
      } catch (RuntimeException ex) {
        log.warn("Growth evaluation failed for rating {}", ratingId, ex);
      }
    }
    log.info(
        "Rating snapshots rewritten: {}; low-rating suspensions: {}; weekly incentive snapshots:"
            + " {}; 5-star ratings evaluated for growth: {}",
        written,
        suspended,
        weekly,
        grown);
  }
}
