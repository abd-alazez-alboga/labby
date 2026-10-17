package com.labby.backend.service;

import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.BadgeCode;
import com.labby.backend.enums.ChallengeGoalType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.PointsTransactionType;
import com.labby.backend.enums.ReferralStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.model.Challenge;
import com.labby.backend.model.ChallengeProgress;
import com.labby.backend.model.Fare;
import com.labby.backend.model.PointsAccount;
import com.labby.backend.model.PointsTransaction;
import com.labby.backend.model.Referral;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.model.UserBadge;
import com.labby.backend.repository.ChallengeProgressRepository;
import com.labby.backend.repository.ChallengeRepository;
import com.labby.backend.repository.PointsAccountRepository;
import com.labby.backend.repository.PointsTransactionRepository;
import com.labby.backend.repository.RatingRepository;
import com.labby.backend.repository.ReferralRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.UserBadgeRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * GRW-03/04, GAME-01..03 (owner rulings 2026-10-18). Everything here is exactly-once by
 * construction: badges by their primary key, the referral by the status transition under its row
 * lock, challenge credits by the linked points transaction set under the progress row lock.
 */
@Service
@RequiredArgsConstructor
public class GrowthServiceImpl implements GrowthService {

  /** 5-star week (GAME-01): at least this many ratings in the window, all five stars. */
  static final int FIVE_STAR_WEEK_MIN_RATINGS = 3;

  private static final Duration WEEK = Duration.ofDays(7);

  private static final Map<BadgeCode, Long> RIDE_BADGES =
      Map.of(BadgeCode.RIDE_10, 10L, BadgeCode.RIDE_50, 50L, BadgeCode.RIDE_100, 100L);

  private final RegionRepository regionRepository;
  private final UserRepository userRepository;
  private final RideRepository rideRepository;
  private final RatingRepository ratingRepository;
  private final ReferralRepository referralRepository;
  private final PointsAccountRepository pointsAccountRepository;
  private final PointsTransactionRepository pointsTransactionRepository;
  private final UserBadgeRepository userBadgeRepository;
  private final ChallengeRepository challengeRepository;
  private final ChallengeProgressRepository challengeProgressRepository;
  private final WalletService walletService;
  private final NotificationService notificationService;

  @Override
  public void onRideCompleted(Ride ride, Fare fare, List<SharedRideMember> members) {
    Instant now = ride.getCompletedAt();
    Region region = regionRepository.findById(ride.getRegionId()).orElseThrow();
    GrowthRules.Settings settings = GrowthRules.settings(region.getGrowthSettings());
    boolean shared = members != null;
    if (shared) {
      for (SharedRideMember member : members) {
        riderCompletion(
            ride, member.getRiderUserId(), member.getShareAmount(), settings, shared, now);
      }
    } else {
      riderCompletion(ride, ride.getRiderUserId(), fare.getTotal(), settings, shared, now);
    }
    driverCompletion(ride, shared, now);
  }

  @Override
  public void onRatingSubmitted(
      Ride ride, UUID ratedUserId, RideParty ratedRole, int score, Instant now) {
    if (score != 5 || suspended(ratedUserId)) {
      return;
    }
    List<Short> scores = ratingRepository.scoresSince(ratedUserId, now.minus(WEEK));
    if (scores.size() >= FIVE_STAR_WEEK_MIN_RATINGS
        && scores.stream().allMatch(value -> value == 5)) {
      award(ratedUserId, BadgeCode.FIVE_STAR_WEEK, ratedRole);
    }
    for (Challenge challenge : challengeRepository.runningAt(ride.getRegionId(), ratedRole, now)) {
      if (challenge.getGoalType() == ChallengeGoalType.FIVE_STAR_RATINGS) {
        bump(challenge, ratedUserId, ratedRole, now);
      }
    }
  }

  /** One payer's completion: accrual, the referral, ride badges, challenge progress. */
  private void riderCompletion(
      Ride ride,
      UUID riderUserId,
      BigDecimal paidAmount,
      GrowthRules.Settings settings,
      boolean shared,
      Instant now) {
    rewardReferral(ride, riderUserId, settings, now);
    if (suspended(riderUserId)) {
      return; // Ruling 6: accrual, badges and challenges are frozen while suspended.
    }
    long points =
        paidAmount
            .multiply(settings.pointsPerCurrencyUnit())
            .setScale(0, RoundingMode.FLOOR)
            .longValue();
    if (points > 0) {
      addPoints(
          riderUserId,
          PointsTransactionType.ACCRUAL,
          points,
          transaction -> transaction.setRideId(ride.getId()));
    }
    long completed = rideRepository.riderCompletedCount(riderUserId);
    rideBadges(riderUserId, completed, RideParty.RIDER);
    if (shared) {
      award(riderUserId, BadgeCode.FIRST_SHARED_RIDE, RideParty.RIDER);
    }
    progressRideChallenges(ride, riderUserId, RideParty.RIDER, shared, now);
  }

  private void driverCompletion(Ride ride, boolean shared, Instant now) {
    UUID driverUserId = ride.getDriverUserId();
    if (suspended(driverUserId)) {
      return;
    }
    rideBadges(
        driverUserId,
        rideRepository.countByDriverUserIdAndState(driverUserId, RideState.COMPLETED),
        RideParty.DRIVER);
    if (shared) {
      award(driverUserId, BadgeCode.FIRST_SHARED_RIDE, RideParty.DRIVER);
    }
    progressRideChallenges(ride, driverUserId, RideParty.DRIVER, shared, now);
  }

  /**
   * GRW-03: the referee's FIRST completed ride pays both sides their region-configured credit in
   * the ride currency, exactly once (the status transition under the row lock). A suspended party
   * blocks the reward for good.
   */
  private void rewardReferral(
      Ride ride, UUID riderUserId, GrowthRules.Settings settings, Instant now) {
    if (rideRepository.riderCompletedCount(riderUserId) != 1) {
      return;
    }
    Referral referral = referralRepository.lockByRefereeUserId(riderUserId).orElse(null);
    if (referral == null || referral.getStatus() != ReferralStatus.PENDING) {
      return;
    }
    if (suspended(riderUserId) || suspended(referral.getReferrerUserId())) {
      referral.setStatus(ReferralStatus.BLOCKED);
      referralRepository.saveAndFlush(referral);
      return;
    }
    credit(referral.getReferrerUserId(), settings.referralReferrerAmount(), ride, "referrer");
    credit(riderUserId, settings.referralRefereeAmount(), ride, "referee");
    referral.setStatus(ReferralStatus.REWARDED);
    referral.setRewardedRideId(ride.getId());
    referral.setRewardedAt(now);
    referralRepository.saveAndFlush(referral);
    award(referral.getReferrerUserId(), BadgeCode.FIRST_REFERRAL, RideParty.RIDER);
  }

  private void credit(UUID userId, BigDecimal amount, Ride ride, String as) {
    if (amount == null || amount.signum() <= 0) {
      return; // Region not configured (defaults): the reward is recorded, nothing is paid.
    }
    walletService.credit(
        userId,
        ride.getCurrency(),
        amount,
        WalletTransactionType.REFERRAL,
        ride.getId(),
        null,
        null);
    notificationService.queue(
        userId,
        NotificationEvent.REFERRAL_REWARDED,
        Map.of(
            "as", as,
            "amount", amount.toPlainString(),
            "currency", ride.getCurrency()));
  }

  private void rideBadges(UUID userId, long completedCount, RideParty as) {
    RIDE_BADGES.forEach(
        (badge, threshold) -> {
          if (completedCount >= threshold) {
            award(userId, badge, as);
          }
        });
  }

  /** GAME-01: exactly-once by the primary key; a race loser silently stands down. */
  private void award(UUID userId, BadgeCode badge, RideParty as) {
    if (userBadgeRepository.existsByUserIdAndBadgeCode(userId, badge.getValue())) {
      return;
    }
    try {
      userBadgeRepository.saveAndFlush(
          UserBadge.builder().userId(userId).badgeCode(badge.getValue()).build());
    } catch (DataIntegrityViolationException ex) {
      return;
    }
    notificationService.queue(
        userId,
        NotificationEvent.BADGE_AWARDED,
        Map.of("badgeCode", badge.getValue(), "as", as.getValue()));
  }

  private void progressRideChallenges(
      Ride ride, UUID userId, RideParty role, boolean shared, Instant now) {
    for (Challenge challenge : challengeRepository.runningAt(ride.getRegionId(), role, now)) {
      boolean counts =
          switch (challenge.getGoalType()) {
            case COMPLETED_RIDES -> true;
            case SHARED_RIDES -> shared;
            case FIVE_STAR_RATINGS -> false;
          };
      if (counts) {
        bump(challenge, userId, role, now);
      }
    }
  }

  /** GAME-02: +1 under the progress row lock; the goal credits the reward exactly once. */
  private void bump(Challenge challenge, UUID userId, RideParty role, Instant now) {
    ChallengeProgress progress =
        challengeProgressRepository.lockOrCreate(challenge.getId(), userId);
    if (progress.getCompletedAt() != null) {
      return;
    }
    progress.setProgress(progress.getProgress() + 1);
    if (progress.getProgress() >= challenge.getGoalTarget()) {
      progress.setCompletedAt(now);
      PointsTransaction reward =
          addPoints(
              userId,
              PointsTransactionType.CHALLENGE,
              challenge.getRewardPoints(),
              transaction -> transaction.setChallengeId(challenge.getId()));
      progress.setPointsTransactionId(reward.getId());
      notificationService.queue(
          userId,
          NotificationEvent.CHALLENGE_COMPLETED,
          Map.of(
              "challengeId", challenge.getId().toString(),
              "points", String.valueOf(challenge.getRewardPoints()),
              "as", role.getValue()));
    }
    challengeProgressRepository.saveAndFlush(progress);
  }

  /** Positive points land on both balances (GAME-03: lifetime only ever grows). */
  private PointsTransaction addPoints(
      UUID userId,
      PointsTransactionType type,
      long points,
      java.util.function.Consumer<PointsTransaction> links) {
    PointsAccount account = pointsAccountRepository.lockOrCreate(userId);
    account.setRedeemable(account.getRedeemable() + points);
    account.setLifetime(account.getLifetime() + points);
    pointsAccountRepository.saveAndFlush(account);
    PointsTransaction transaction =
        PointsTransaction.builder().userId(userId).type(type).points(points).build();
    links.accept(transaction);
    return pointsTransactionRepository.saveAndFlush(transaction);
  }

  private boolean suspended(UUID userId) {
    return userRepository
        .findById(userId)
        .map(User::getState)
        .map(state -> state != AccountState.ACTIVE)
        .orElse(true);
  }
}
