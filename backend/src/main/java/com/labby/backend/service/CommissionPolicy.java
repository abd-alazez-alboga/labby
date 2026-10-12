package com.labby.backend.service;

import com.labby.backend.model.Region;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * The COM-02 tier rules: a region's commission tiers (or the SRS defaults 25 / 20 above 100 / 15
 * above 200 when the region sets none), resolved against a week's completed trips — {@code above}
 * is strictly greater, the tier with the highest exceeded threshold wins, and no exceeded tier
 * means the base tier (the lowest threshold). Weeks start Monday in the region's time zone.
 * Commission amounts round HALF_UP to 2 decimals (owner ruling 2026-10-11).
 */
@Component
public class CommissionPolicy {

  /** One commission tier: {@code percent} applies above {@code weeklyTripsAbove} trips. */
  public record Tier(int weeklyTripsAbove, BigDecimal percent) {}

  /** SRS COM-02 defaults when the region configures no tiers. */
  public static final List<Tier> DEFAULT_TIERS =
      List.of(
          new Tier(0, new BigDecimal("25")),
          new Tier(100, new BigDecimal("20")),
          new Tier(200, new BigDecimal("15")));

  /**
   * The region's tiers, threshold-ascending (SRS defaults when the region sets none).
   *
   * @param region the region
   * @return the tiers
   */
  public List<Tier> tiers(Region region) {
    List<Map<String, Object>> configured = region.getCommissionTiers();
    if (configured == null || configured.isEmpty()) {
      return DEFAULT_TIERS;
    }
    List<Tier> tiers = new ArrayList<>();
    for (Map<String, Object> tier : configured) {
      tiers.add(
          new Tier(
              ((Number) tier.get("weeklyTripsAbove")).intValue(),
              new BigDecimal(tier.get("percent").toString())));
    }
    tiers.sort(Comparator.comparingInt(Tier::weeklyTripsAbove));
    return tiers;
  }

  /**
   * The percent a week's completed trips earn.
   *
   * @param weeklyTrips the previous week's completed trips
   * @param tiers the region's tiers (threshold-ascending)
   * @return the percent
   */
  public BigDecimal percentFor(int weeklyTrips, List<Tier> tiers) {
    Tier best = baseTier(tiers);
    for (Tier tier : tiers) {
      if (weeklyTrips > tier.weeklyTripsAbove()) {
        best = tier;
      }
    }
    return best.percent();
  }

  /**
   * The base tier — what applies without a rate row (COM-02).
   *
   * @param tiers the region's tiers (threshold-ascending)
   * @return the lowest-threshold tier
   */
  public Tier baseTier(List<Tier> tiers) {
    return tiers.get(0);
  }

  /**
   * The next tier more trips THIS week would earn next week (UC-D-15 progress).
   *
   * @param weeklyTrips the current week's completed trips so far
   * @param tiers the region's tiers (threshold-ascending)
   * @return the next tier, or empty when the top tier is already earned
   */
  public Optional<Tier> nextTier(int weeklyTrips, List<Tier> tiers) {
    Tier earned = baseTier(tiers);
    for (Tier tier : tiers) {
      if (weeklyTrips > tier.weeklyTripsAbove()) {
        earned = tier;
      }
    }
    for (Tier tier : tiers) {
      if (tier.weeklyTripsAbove() > earned.weeklyTripsAbove()) {
        return Optional.of(tier);
      }
    }
    return Optional.empty();
  }

  /**
   * The Monday starting the week containing {@code at} in a zone.
   *
   * @param at the moment
   * @param zone the region's time zone
   * @return the week-start date
   */
  public static LocalDate weekStart(Instant at, ZoneId zone) {
    return LocalDate.ofInstant(at, zone).with(DayOfWeek.MONDAY);
  }

  /**
   * The commission on a fare, rounded HALF_UP to 2 decimals.
   *
   * @param fareTotal the fare total
   * @param percent the rate percent
   * @return the commission amount
   */
  public static BigDecimal commission(BigDecimal fareTotal, BigDecimal percent) {
    return fareTotal.multiply(percent).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
  }
}
