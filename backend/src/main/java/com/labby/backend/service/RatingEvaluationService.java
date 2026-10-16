package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import com.labby.backend.repository.RatingRepository;
import java.util.List;
import java.util.UUID;

/**
 * The daily USR-05 / RATE-03 evaluation (review B-H1, owner ruling 2026-10-16): never on a stored
 * rating — a suspension right after a ride would identify its rater — but once a day by {@link
 * RatingSnapshotJob}, on the LIVE lifetime average, against the rule of the region of the user x
 * role's latest rated ride.
 */
public interface RatingEvaluationService {

  /**
   * Every rated user x role.
   *
   * @return the candidates
   */
  List<RatingRepository.RatedPair> candidates();

  /**
   * Evaluates one user x role in its own transaction, the role assignment locked first (review
   * B-W2): below {@code warnAvgRating} with the minimum count opens a {@code low_rating} flag;
   * below {@code minAvgRating} suspends an ACTIVE role — after an admin reactivation only once a
   * rating was stored after it.
   *
   * @param userId the rated user
   * @param role the rated role
   * @return true when the role was suspended now
   */
  boolean evaluate(UUID userId, RideParty role);
}
