package com.labby.backend.dto;

import com.labby.backend.enums.GrowthLevel;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** The caller's points, level ladder and the region redemption rule (growth-v1 LoyaltyBalance). */
public record LoyaltyBalanceDto(
    long redeemable, long lifetime, GrowthLevel level, List<LevelDto> levels, LoyaltyRuleDto rule) {

  /** One rung of the ladder (GAME-03). */
  public record LevelDto(GrowthLevel level, long thresholdPoints) {}

  /** The region's loyalty knobs (ruling 4). */
  public record LoyaltyRuleDto(
      UUID regionId,
      String currency,
      BigDecimal pointsPerCurrencyUnit,
      long redemptionThresholdPoints,
      BigDecimal redemptionRate) {}
}
