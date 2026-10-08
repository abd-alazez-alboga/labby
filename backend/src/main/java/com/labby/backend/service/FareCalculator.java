package com.labby.backend.service;

import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SurchargeWindow;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Collection;
import org.springframework.stereotype.Component;

/**
 * The fare engine core (PRC-01, RIDE-06) — the ONE calculation behind both the estimate and the
 * metered final fare, so they can only differ by their inputs (distance, duration):
 *
 * <ol>
 *   <li>base + per-km × km + per-min × min (each component rounded half-up to 2 decimals);
 *   <li>surcharge = percent × that subtotal;
 *   <li>surge uplift = (subtotal + surcharge) × (multiplier − 1) — 0 until M9;
 *   <li>wait / pickup fee / discount — 0 in M7 (M8);
 *   <li>minimum-fare top-up so the total never falls below the service type's minimum.
 * </ol>
 *
 * Surcharge windows (owner decision 2026-10-07): evaluated in the region's time zone; start
 * inclusive, end exclusive; an end earlier than the start runs overnight across midnight and
 * belongs to the day it starts on; start = end covers that whole day; overlapping windows → the
 * HIGHEST percent applies, never a sum.
 */
@Component
public class FareCalculator {

  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
  private static final BigDecimal THOUSAND = BigDecimal.valueOf(1000);
  private static final BigDecimal SIXTY = BigDecimal.valueOf(60);

  /**
   * Prices a distance + duration for a service type.
   *
   * @param serviceType the region's service type (its rates and minimum)
   * @param currency the region currency
   * @param distanceMeters routed (estimate) or metered (final) distance
   * @param durationSeconds routed or actual duration
   * @param surchargePercent the time-window surcharge (0 = none)
   * @param surgeMultiplier the locked surge multiplier (≥ 1)
   * @return every component and the total
   */
  public FareComponentsDto price(
      ServiceType serviceType,
      String currency,
      long distanceMeters,
      long durationSeconds,
      BigDecimal surchargePercent,
      BigDecimal surgeMultiplier) {
    BigDecimal km = BigDecimal.valueOf(distanceMeters).divide(THOUSAND);
    BigDecimal minutes = BigDecimal.valueOf(durationSeconds).divide(SIXTY, 6, RoundingMode.HALF_UP);
    BigDecimal base = money(serviceType.getBaseFare());
    BigDecimal distanceFare = money(serviceType.getPerKmRate().multiply(km));
    BigDecimal timeFare = money(serviceType.getPerMinRate().multiply(minutes));
    BigDecimal subtotal = base.add(distanceFare).add(timeFare);
    BigDecimal surcharge = money(subtotal.multiply(surchargePercent).divide(HUNDRED));
    BigDecimal surge =
        money(subtotal.add(surcharge).multiply(surgeMultiplier.subtract(BigDecimal.ONE)));
    BigDecimal zero = money(BigDecimal.ZERO);
    BigDecimal beforeFloor = subtotal.add(surcharge).add(surge);
    BigDecimal minimum = money(serviceType.getMinimumFare());
    BigDecimal topUp = beforeFloor.compareTo(minimum) < 0 ? minimum.subtract(beforeFloor) : zero;
    return new FareComponentsDto(
        currency,
        base,
        distanceFare,
        timeFare,
        surchargePercent.setScale(2, RoundingMode.HALF_UP),
        surcharge,
        surgeMultiplier.setScale(2, RoundingMode.HALF_UP),
        surge,
        zero,
        zero,
        topUp,
        zero,
        beforeFloor.add(topUp));
  }

  /**
   * The surcharge percent in force at a moment (highest of the covering windows, else 0).
   *
   * @param windows the region's surcharge windows
   * @param at the moment (the request time)
   * @param zone the region's time zone
   * @return the percent
   */
  public BigDecimal surchargePercent(Collection<SurchargeWindow> windows, Instant at, ZoneId zone) {
    ZonedDateTime local = at.atZone(zone);
    BigDecimal best = BigDecimal.ZERO;
    for (SurchargeWindow window : windows) {
      if (covers(window, local) && window.getPercent().compareTo(best) > 0) {
        best = window.getPercent();
      }
    }
    return best;
  }

  private static boolean covers(SurchargeWindow window, ZonedDateTime local) {
    LocalTime time = local.toLocalTime();
    LocalTime start = window.getStartsAt();
    LocalTime end = window.getEndsAt();
    int today = local.getDayOfWeek().getValue();
    int yesterday = local.getDayOfWeek().minus(1).getValue();
    if (start.equals(end)) {
      return window.getDaysOfWeek().contains(today);
    }
    if (start.isBefore(end)) {
      return window.getDaysOfWeek().contains(today) && !time.isBefore(start) && time.isBefore(end);
    }
    // Overnight: the evening part belongs to today's window, the early-morning part to the window
    // that started yesterday.
    return (window.getDaysOfWeek().contains(today) && !time.isBefore(start))
        || (window.getDaysOfWeek().contains(yesterday) && time.isBefore(end));
  }

  private static BigDecimal money(BigDecimal value) {
    return value.setScale(2, RoundingMode.HALF_UP);
  }
}
