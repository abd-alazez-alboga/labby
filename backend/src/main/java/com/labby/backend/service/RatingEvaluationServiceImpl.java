package com.labby.backend.service;

import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.model.Region;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.repository.AccountFlagRepository;
import com.labby.backend.repository.RatingRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The daily rating-rule evaluation (see {@link RatingEvaluationService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class RatingEvaluationServiceImpl implements RatingEvaluationService {

  private final RatingRepository ratingRepository;
  private final AccountFlagRepository accountFlagRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RegionRepository regionRepository;
  private final AccountFlagService accountFlagService;
  private final SuspensionService suspensionService;

  @Override
  @Transactional(readOnly = true)
  public List<RatingRepository.RatedPair> candidates() {
    return ratingRepository.findRatedPairs();
  }

  @Override
  public boolean evaluate(UUID userId, RideParty role) {
    // B-W2: the role row is locked before the aggregate is read, so concurrent evaluations of the
    // same user x role serialize and decide on the same data.
    RoleAssignment assignment =
        roleAssignmentRepository
            .findForUpdate(userId, role == RideParty.DRIVER ? Role.DRIVER : Role.RIDER)
            .orElse(null);
    if (assignment == null) {
      return false;
    }
    UUID regionId = ratingRepository.latestRatedRegion(userId, role.getValue()).orElse(null);
    Region region = regionId == null ? null : regionRepository.findById(regionId).orElse(null);
    TrustRules.RatingRule rule =
        TrustRules.ratingRule(region == null ? null : region.getSuspensionThresholds(), role);
    RatingRepository.LiveAggregate aggregate =
        ratingRepository.liveAggregate(userId, role.getValue());
    long count = aggregate.getRatingCount();
    BigDecimal average = aggregate.getAverage();
    if (TrustRules.below(average, count, rule.warnAvgRating(), rule.minRatedRides())
        && mayOpenLowRatingFlag(userId, role)) {
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("average", average.setScale(2, RoundingMode.HALF_UP));
      details.put("ratingCount", count);
      details.put("warnAvgRating", rule.warnAvgRating());
      details.put("minRatedRides", rule.minRatedRides());
      if (regionId != null) {
        details.put("regionId", regionId.toString());
      }
      accountFlagService.open(userId, role, FlagKind.LOW_RATING, details);
    }
    if (!TrustRules.below(average, count, rule.minAvgRating(), rule.minRatedRides())) {
      return false;
    }
    // Re-fire rule: after an admin reactivation, only a rating stored since then may suspend.
    if (assignment.getReactivatedAt() != null
        && !ratingRepository.existsByRatedUserIdAndRatedRoleAndCreatedAtAfter(
            userId, role, assignment.getReactivatedAt())) {
      return false;
    }
    return suspensionService.suspendForLowRating(userId, role, rule);
  }

  /**
   * RATE-03 reopen rule (owner ruling 2026-10-16): once a low_rating flag was closed (dismissed or
   * actioned), a new one opens only after a rating stored since the closing; a user x role never
   * flagged before is flagged as soon as the rule holds.
   */
  private boolean mayOpenLowRatingFlag(UUID userId, RideParty role) {
    return accountFlagRepository
        .latestClosedAt(userId, role, FlagKind.LOW_RATING)
        .map(
            closedAt ->
                ratingRepository.existsByRatedUserIdAndRatedRoleAndCreatedAtAfter(
                    userId, role, closedAt))
        .orElse(true);
  }
}
