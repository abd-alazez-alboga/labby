package com.labby.backend.service;

import java.math.BigDecimal;
import java.util.Map;

/**
 * M13 growth rules (growth-v1.yaml, owner rulings 2026-10-18): a region's {@code growthSettings}
 * resolved against the code defaults. Referral amounts default to 0 — a reward is recorded but
 * nothing is paid until the region configures them. Pure.
 */
public final class GrowthRules {

  /**
   * The SRS defaults (GRW-03 "5 + 5", GRW-04 "100 pts → 5 credit", owner ruling 2026-10-18 on the
   * M13 review W5): referral 5 + 5 in the region currency, 1 pt / currency unit, redeem 100+ pts at
   * 0.05 / pt. A region's own growthSettings override them.
   */
  public static final Settings DEFAULTS =
      new Settings(
          new BigDecimal("5.00"),
          new BigDecimal("5.00"),
          BigDecimal.ONE,
          100L,
          new BigDecimal("0.05"));

  private GrowthRules() {}

  /**
   * The growth settings of a region; null or incomplete JSON = the defaults.
   *
   * @param growthSettings the region's JSON (may be null)
   * @return the settings
   */
  public static Settings settings(Map<String, Object> growthSettings) {
    if (growthSettings == null) {
      return DEFAULTS;
    }
    BigDecimal referrer = decimal(growthSettings.get("referralReferrerAmount"));
    BigDecimal referee = decimal(growthSettings.get("referralRefereeAmount"));
    BigDecimal rate = decimal(growthSettings.get("pointsPerCurrencyUnit"));
    BigDecimal redemptionRate = decimal(growthSettings.get("redemptionRate"));
    Long threshold = longValue(growthSettings.get("redemptionThresholdPoints"));
    if (referrer == null
        || referee == null
        || rate == null
        || redemptionRate == null
        || threshold == null) {
      return DEFAULTS;
    }
    return new Settings(referrer, referee, rate, threshold, redemptionRate);
  }

  private static BigDecimal decimal(Object value) {
    if (value instanceof BigDecimal decimal) {
      return decimal;
    }
    if (value instanceof Number number) {
      return new BigDecimal(number.toString());
    }
    if (value instanceof String text) {
      try {
        return new BigDecimal(text);
      } catch (NumberFormatException ex) {
        return null;
      }
    }
    return null;
  }

  private static Long longValue(Object value) {
    BigDecimal decimal = decimal(value);
    return decimal == null ? null : decimal.longValue();
  }

  /**
   * One region's resolved growth knobs.
   *
   * @param referralReferrerAmount the referrer's reward in the region currency (0 = none)
   * @param referralRefereeAmount the referee's reward in the region currency (0 = none)
   * @param pointsPerCurrencyUnit loyalty accrual per currency unit of the own paid fare
   * @param redemptionThresholdPoints the minimum redeemable points per redemption
   * @param redemptionRate wallet credit per point redeemed
   */
  public record Settings(
      BigDecimal referralReferrerAmount,
      BigDecimal referralRefereeAmount,
      BigDecimal pointsPerCurrencyUnit,
      long redemptionThresholdPoints,
      BigDecimal redemptionRate) {}
}
