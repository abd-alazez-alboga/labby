package com.labby.backend.dto;

import com.labby.backend.enums.BadgeCode;
import com.labby.backend.enums.GrowthLevel;
import java.time.Instant;
import java.util.List;

/**
 * The caller's badges and level (growth-v1 GamificationView; UC-S-23/24). {@code lifetime} counts
 * loyalty earned for riders, trips + challenge points for drivers (GAME-03).
 */
public record GamificationViewDto(
    List<BadgeViewDto> badges,
    GrowthLevel level,
    long lifetime,
    List<LoyaltyBalanceDto.LevelDto> levels) {

  /** One catalog badge, in sort order, earned or not. */
  public record BadgeViewDto(BadgeCode badgeCode, boolean earned, Instant awardedAt) {}
}
