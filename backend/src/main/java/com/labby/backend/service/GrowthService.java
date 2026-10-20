package com.labby.backend.service;

import com.labby.backend.model.Fare;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The M13 growth engine's event intake (GRW-03/04, GAME-01..03): ride completions feed loyalty
 * accrual, the referral reward, ride badges and challenge progress; the nightly rating pass feeds
 * the 5-star badge and rating challenges (V1 conformance H5). Completions run inside the triggering
 * transaction. A suspended account is frozen (owner ruling 6): no accrual, no challenge progress,
 * referral rewards blocked.
 */
public interface GrowthService {

  /**
   * A ride completed: every payer accrues loyalty on their own paid amount, the referee's first
   * completion pays the referral, ride badges and challenge progress advance for every party.
   *
   * @param ride the completed ride (state already {@code completed})
   * @param fare its stored fare
   * @param members the boarded members of a shared ride, or null for a one-rider ride
   */
  void onRideCompleted(Ride ride, Fare fare, List<SharedRideMember> members);

  /**
   * The 5-star ratings the nightly pass still has to evaluate, oldest first. V1 conformance H5
   * (owner ruling 2026-10-20): the 5-star week badge and {@code five_star_ratings} challenge
   * progress are evaluated by the nightly {@link RatingSnapshotJob}, never when a rating is stored,
   * so neither moves right after a given ride.
   *
   * @return the rating ids
   */
  List<UUID> pendingRatingEvaluations();

  /**
   * Evaluates one 5-star rating, exactly once, in its own transaction: a 5-star week ending at the
   * rating awards the badge, and every {@code five_star_ratings} challenge running at the rating's
   * moment advances. Completions and notifications carry the pass moment, never the rating's.
   *
   * @param ratingId the rating
   * @param now the pass moment
   */
  void evaluateRating(UUID ratingId, Instant now);
}
