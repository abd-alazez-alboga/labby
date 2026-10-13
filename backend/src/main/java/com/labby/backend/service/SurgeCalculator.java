package com.labby.backend.service;

import com.labby.backend.dto.ThresholdStepDto;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.stream.Stream;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

/**
 * The surge math (PRC-02), pure so the cycle, the admin state and the driver heatmap share it:
 *
 * <ol>
 *   <li>no demand → 1.00; demand without supply → the top step (highest ratio);
 *   <li>otherwise the highest step whose ratio the demand/supply ratio reaches (compared exactly as
 *       {@code demand >= ratio × supply}, so boundaries never suffer division rounding); no step
 *       reached → 1.00;
 *   <li>capped at the lower of the zone cap and the region cap (a null cap does not limit).
 * </ol>
 *
 * Steps are evaluated in ratio order whatever order the stored JSON has.
 */
@Component
public class SurgeCalculator {

  /** No surge: the multiplier outside every zone, and of a zone without demand. */
  public static final BigDecimal NO_SURGE = new BigDecimal("1.00");

  /**
   * The capped multiplier a zone's demand and supply reach.
   *
   * @param steps the zone's threshold steps (any order)
   * @param demand open requests in the zone
   * @param supply idle online drivers in the zone
   * @param zoneCap the zone's cap, or null
   * @param regionCap the region's cap, or null
   * @return the multiplier, 2 decimals, ≥ 1.00
   */
  public BigDecimal computed(
      List<ThresholdStepDto> steps,
      long demand,
      long supply,
      BigDecimal zoneCap,
      BigDecimal regionCap) {
    List<ThresholdStepDto> ordered = ordered(steps);
    if (demand <= 0 || ordered.isEmpty()) {
      return NO_SURGE;
    }
    BigDecimal multiplier = NO_SURGE;
    if (supply <= 0) {
      multiplier = ordered.get(ordered.size() - 1).multiplier();
    } else {
      BigDecimal demandValue = BigDecimal.valueOf(demand);
      BigDecimal supplyValue = BigDecimal.valueOf(supply);
      for (ThresholdStepDto step : ordered) {
        if (demandValue.compareTo(step.ratio().multiply(supplyValue)) >= 0) {
          multiplier = step.multiplier();
        }
      }
    }
    BigDecimal cap = effectiveCap(zoneCap, regionCap);
    if (cap != null && multiplier.compareTo(cap) > 0) {
      multiplier = cap;
    }
    return multiplier.max(BigDecimal.ONE).setScale(2, RoundingMode.HALF_UP);
  }

  /**
   * The cap that binds a zone: the lower of its own cap and its region's (PRC-02).
   *
   * @param zoneCap the zone's cap, or null
   * @param regionCap the region's cap, or null
   * @return the binding cap, or null when neither is set
   */
  public BigDecimal effectiveCap(BigDecimal zoneCap, BigDecimal regionCap) {
    return Stream.of(zoneCap, regionCap)
        .filter(Objects::nonNull)
        .min(Comparator.naturalOrder())
        .orElse(null);
  }

  /**
   * What pricing uses (UC-A-09): the manual override when set — clamped to the binding cap, so an
   * override stays within a cap lowered after it was set — else the computed value.
   *
   * @param override the zone's manual override, or null
   * @param computed the cycle's computed multiplier
   * @param zoneCap the zone's cap, or null
   * @param regionCap the region's cap, or null
   * @return the current multiplier
   */
  public BigDecimal current(
      BigDecimal override, BigDecimal computed, BigDecimal zoneCap, BigDecimal regionCap) {
    if (override == null) {
      return computed;
    }
    BigDecimal cap = effectiveCap(zoneCap, regionCap);
    return cap != null && override.compareTo(cap) > 0 ? cap : override;
  }

  /**
   * The heatmap level of a multiplier (DRV-09): 0 = no surge, else n = the 1-based position (in
   * ratio order) of the highest step whose multiplier the current value reaches — so an override
   * maps onto the zone's own scale too. Any surge is at least level 1, so a value below the first
   * step (a cap or an override under it) never shows calm while riders pay surge.
   *
   * @param steps the zone's threshold steps (any order)
   * @param current the zone's current multiplier
   * @return the level
   */
  public int level(List<ThresholdStepDto> steps, BigDecimal current) {
    if (current == null || current.compareTo(BigDecimal.ONE) <= 0) {
      return 0;
    }
    List<ThresholdStepDto> ordered = ordered(steps);
    int level = 0;
    for (int i = 0; i < ordered.size(); i++) {
      if (ordered.get(i).multiplier().compareTo(current) <= 0) {
        level = i + 1;
      }
    }
    return Math.max(level, 1);
  }

  /**
   * When a cron next fires after a moment (the job runs in the server's default zone).
   *
   * @param cron the Spring cron, or "-" when disabled
   * @param after the moment
   * @return the next fire time, or null when disabled
   */
  public Instant nextFire(String cron, Instant after) {
    if (cron == null || cron.isBlank() || "-".equals(cron.trim())) {
      return null;
    }
    ZonedDateTime next =
        CronExpression.parse(cron).next(ZonedDateTime.ofInstant(after, ZoneId.systemDefault()));
    return next == null ? null : next.toInstant();
  }

  /**
   * Where the current cycle began, for skipping zones another instance already computed in it
   * (NFR-P4): half a cycle period before {@code now}, the period being the gap between the cron's
   * next two fire times.
   *
   * @param cron the Spring cron, or "-" when disabled
   * @param now the moment the cycle runs
   * @return the cycle start, or null when the cron is disabled (no skipping: only tests then call
   *     the cycle, on their own clock)
   */
  public Instant cycleStart(String cron, Instant now) {
    Instant first = nextFire(cron, now);
    Instant second = first == null ? null : nextFire(cron, first);
    if (second == null) {
      return null;
    }
    return now.minus(Duration.between(first, second).dividedBy(2));
  }

  private static List<ThresholdStepDto> ordered(List<ThresholdStepDto> steps) {
    return steps == null
        ? List.of()
        : steps.stream().sorted(Comparator.comparing(ThresholdStepDto::ratio)).toList();
  }
}
