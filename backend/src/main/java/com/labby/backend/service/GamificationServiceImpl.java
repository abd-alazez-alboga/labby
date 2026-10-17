package com.labby.backend.service;

import com.labby.backend.dto.ChallengeViewDto;
import com.labby.backend.dto.GamificationViewDto;
import com.labby.backend.dto.LoyaltyBalanceDto;
import com.labby.backend.enums.BadgeCode;
import com.labby.backend.enums.GrowthLevel;
import com.labby.backend.enums.PointsTransactionType;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.model.Challenge;
import com.labby.backend.model.ChallengeProgress;
import com.labby.backend.model.PointsAccount;
import com.labby.backend.model.UserBadge;
import com.labby.backend.repository.ChallengeProgressRepository;
import com.labby.backend.repository.ChallengeRepository;
import com.labby.backend.repository.PointsAccountRepository;
import com.labby.backend.repository.PointsTransactionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.UserBadgeRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * GAME-01/03 (owner 2026-10-18): the full catalog with earned flags; levels from lifetime points —
 * riders their loyalty earned, drivers their completed trips plus challenge points — never
 * decreasing on redemption. Recently ended challenges stay listed for a week.
 */
@Service
@RequiredArgsConstructor
public class GamificationServiceImpl implements GamificationService {

  private static final Duration ENDED_SHOWN = Duration.ofDays(7);

  private static final List<LoyaltyBalanceDto.LevelDto> LADDER =
      Arrays.stream(GrowthLevel.values())
          .map(level -> new LoyaltyBalanceDto.LevelDto(level, level.getThresholdPoints()))
          .toList();

  private final UserBadgeRepository userBadgeRepository;
  private final PointsAccountRepository pointsAccountRepository;
  private final PointsTransactionRepository pointsTransactionRepository;
  private final RideRepository rideRepository;
  private final ChallengeRepository challengeRepository;
  private final ChallengeProgressRepository challengeProgressRepository;
  private final RideAccess rideAccess;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public GamificationViewDto me(UUID userId, RideParty as) {
    rideAccess.requireRider(userId);
    Map<BadgeCode, Instant> earned =
        userBadgeRepository.findByUserId(userId).stream()
            .collect(
                Collectors.toMap(
                    badge -> BadgeCode.fromValue(badge.getBadgeCode()), UserBadge::getAwardedAt));
    long lifetime = lifetime(userId, as);
    return new GamificationViewDto(
        Arrays.stream(BadgeCode.values())
            .map(
                badge ->
                    new GamificationViewDto.BadgeViewDto(
                        badge, earned.containsKey(badge), earned.get(badge)))
            .toList(),
        GrowthLevel.of(lifetime),
        lifetime,
        LADDER);
  }

  @Override
  @Transactional(readOnly = true)
  public List<ChallengeViewDto> challenges(UUID userId, UUID regionId, RideParty as) {
    rideAccess.requireRider(userId);
    Instant now = clock.instant();
    List<Challenge> challenges = challengeRepository.userList(regionId, as, now.minus(ENDED_SHOWN));
    Map<UUID, ChallengeProgress> progress =
        challengeProgressRepository
            .findByUserIdAndChallengeIdIn(
                userId, challenges.stream().map(Challenge::getId).toList())
            .stream()
            .collect(Collectors.toMap(ChallengeProgress::getChallengeId, Function.identity()));
    return challenges.stream()
        .sorted(
            Comparator.comparingInt((Challenge challenge) -> phase(challenge, now))
                .thenComparing(Challenge::getStartsAt))
        .map(
            challenge -> {
              ChallengeProgress mine = progress.get(challenge.getId());
              return new ChallengeViewDto(
                  challenge.getId(),
                  challenge.getTitleEn(),
                  challenge.getTitleAr(),
                  challenge.getGoalType(),
                  challenge.getGoalTarget(),
                  challenge.getRewardPoints(),
                  challenge.getStartsAt(),
                  challenge.getEndsAt(),
                  !challenge.runningAt(now) && !now.isBefore(challenge.getStartsAt()),
                  mine == null ? 0 : mine.getProgress(),
                  mine != null && mine.getCompletedAt() != null);
            })
        .toList();
  }

  /** Running 0, upcoming 1, ended 2 — the list order the contract names. */
  private static int phase(Challenge challenge, Instant now) {
    if (challenge.runningAt(now)) {
      return 0;
    }
    return now.isBefore(challenge.getStartsAt()) ? 1 : 2;
  }

  private long lifetime(UUID userId, RideParty as) {
    if (as == RideParty.RIDER) {
      return pointsAccountRepository.findById(userId).map(PointsAccount::getLifetime).orElse(0L);
    }
    return rideRepository.countByDriverUserIdAndState(userId, RideState.COMPLETED)
        + pointsTransactionRepository.sumByType(userId, PointsTransactionType.CHALLENGE);
  }
}
