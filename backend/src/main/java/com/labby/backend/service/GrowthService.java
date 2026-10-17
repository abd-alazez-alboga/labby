package com.labby.backend.service;

import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Fare;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The M13 growth engine's event intake (GRW-03/04, GAME-01..03): ride completions feed loyalty
 * accrual, the referral reward, ride badges and challenge progress; ratings feed the 5-star badge
 * and rating challenges. Runs inside the triggering transaction. A suspended account is frozen
 * (owner ruling 6): no accrual, no challenge progress, referral rewards blocked.
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
   * A rating landed: a 5-star one may finish the rated user's 5-star week and advances their rating
   * challenges.
   *
   * @param ride the rated ride
   * @param ratedUserId the rated user
   * @param ratedRole the rated role
   * @param score the score
   * @param now the submission moment
   */
  void onRatingSubmitted(Ride ride, UUID ratedUserId, RideParty ratedRole, int score, Instant now);
}
