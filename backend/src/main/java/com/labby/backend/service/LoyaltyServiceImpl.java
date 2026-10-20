package com.labby.backend.service;

import com.labby.backend.dto.LoyaltyBalanceDto;
import com.labby.backend.dto.PointsTransactionDto;
import com.labby.backend.dto.PointsTransactionPageDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.GrowthLevel;
import com.labby.backend.enums.PointsTransactionType;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.PointsAccount;
import com.labby.backend.model.PointsTransaction;
import com.labby.backend.model.Region;
import com.labby.backend.model.User;
import com.labby.backend.model.WalletTransaction;
import com.labby.backend.repository.PointsAccountRepository;
import com.labby.backend.repository.PointsTransactionRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** GRW-04 (owner rulings 4–6, 2026-10-18). Redemptions run under the points-account row lock. */
@Service
@RequiredArgsConstructor
public class LoyaltyServiceImpl implements LoyaltyService {

  private static final List<LoyaltyBalanceDto.LevelDto> LADDER =
      Arrays.stream(GrowthLevel.values())
          .map(level -> new LoyaltyBalanceDto.LevelDto(level, level.getThresholdPoints()))
          .toList();

  private final PointsAccountRepository pointsAccountRepository;
  private final PointsTransactionRepository pointsTransactionRepository;
  private final RegionRepository regionRepository;
  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final WalletService walletService;
  private final RideAccess rideAccess;

  @Override
  @Transactional(readOnly = true)
  public LoyaltyBalanceDto balance(UUID userId, UUID regionId) {
    rideAccess.requireRider(userId);
    PointsAccount account = pointsAccountRepository.findById(userId).orElse(null);
    return balanceDto(account, region(regionId));
  }

  @Override
  @Transactional(readOnly = true)
  public PointsTransactionPageDto transactions(UUID userId, int page, int size) {
    rideAccess.requireRider(userId);
    Page<PointsTransaction> result =
        pointsTransactionRepository.findByUserIdOrderByCreatedAtDesc(
            userId, PageRequest.of(page, size));
    return new PointsTransactionPageDto(
        result.getContent().stream()
            .map(
                transaction ->
                    new PointsTransactionDto(
                        transaction.getId(),
                        transaction.getType(),
                        transaction.getPoints(),
                        transaction.getRideId(),
                        transaction.getChallengeId(),
                        transaction.getWalletTransactionId(),
                        transaction.getCreatedAt()))
            .toList(),
        page,
        size,
        result.getTotalElements());
  }

  @Override
  @Transactional
  public LoyaltyBalanceDto redeem(UUID userId, UUID regionId, long points) {
    rideAccess.requireRider(userId);
    if (userRepository.findById(userId).map(User::getState).orElse(null) != AccountState.ACTIVE) {
      // Ruling 6: redemption is frozen while suspended; the points are kept.
      throw (ForbiddenException)
          new ForbiddenException("Your account is suspended").withCode("account_suspended");
    }
    if (roleAssignmentRepository
        .findByUserIdAndRole(userId, Role.RIDER)
        .map(assignment -> assignment.getState() == RoleState.SUSPENDED)
        .orElse(false)) {
      // V1 audit I21: a rider ROLE suspension (USR-05 / manual) freezes redemption too.
      throw (ForbiddenException)
          new ForbiddenException("Your rider account is suspended").withCode("account_suspended");
    }
    Region region = region(regionId);
    GrowthRules.Settings settings = GrowthRules.settings(region.getGrowthSettings());
    if (points < settings.redemptionThresholdPoints()) {
      throw (ConflictException)
          new ConflictException("Below the redemption threshold")
              .withCode("below_threshold")
              .withDetail("thresholdPoints", settings.redemptionThresholdPoints());
    }
    PointsAccount account = pointsAccountRepository.lockOrCreate(userId);
    if (points > account.getRedeemable()) {
      throw (ConflictException)
          new ConflictException("Not enough redeemable points")
              .withCode("insufficient_points")
              .withDetail("redeemable", account.getRedeemable());
    }
    BigDecimal credit =
        settings
            .redemptionRate()
            .multiply(BigDecimal.valueOf(points))
            .setScale(2, RoundingMode.HALF_UP);
    if (credit.signum() <= 0) {
      throw (ConflictException)
          new ConflictException("Below the redemption threshold")
              .withCode("below_threshold")
              .withDetail("thresholdPoints", settings.redemptionThresholdPoints());
    }
    // Redeemable spends down; lifetime never does (GAME-03). The wallet credit is traceable back
    // from the points transaction (milestone AC).
    account.setRedeemable(account.getRedeemable() - points);
    pointsAccountRepository.saveAndFlush(account);
    WalletTransaction walletTransaction =
        walletService.credit(
            userId,
            region.getCurrency(),
            credit,
            WalletTransactionType.LOYALTY_REDEMPTION,
            null,
            null,
            null);
    pointsTransactionRepository.saveAndFlush(
        PointsTransaction.builder()
            .userId(userId)
            .type(PointsTransactionType.REDEMPTION)
            .points(-points)
            .walletTransactionId(walletTransaction.getId())
            .build());
    return balanceDto(account, region);
  }

  private Region region(UUID regionId) {
    return regionRepository
        .findById(regionId)
        .orElseThrow(
            () ->
                (ResourceNotFoundException)
                    new ResourceNotFoundException("This region does not exist")
                        .withCode("region_not_found"));
  }

  private static LoyaltyBalanceDto balanceDto(PointsAccount account, Region region) {
    long redeemable = account == null ? 0 : account.getRedeemable();
    long lifetime = account == null ? 0 : account.getLifetime();
    GrowthRules.Settings settings = GrowthRules.settings(region.getGrowthSettings());
    return new LoyaltyBalanceDto(
        redeemable,
        lifetime,
        GrowthLevel.of(lifetime),
        LADDER,
        new LoyaltyBalanceDto.LoyaltyRuleDto(
            region.getId(),
            region.getCurrency(),
            settings.pointsPerCurrencyUnit(),
            settings.redemptionThresholdPoints(),
            settings.redemptionRate()));
  }
}
