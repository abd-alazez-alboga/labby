package com.labby.backend.service;

import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SurchargeWindow;
import com.labby.backend.util.TimeWindows;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
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
 *   <li>surge uplift = (subtotal + surcharge) × (multiplier − 1), the pickup-zone multiplier locked
 *       at request (PRC-02);
 *   <li>wait charge + pickup-distance fee (M8, computed by {@code RideExtrasCalculator}; 0 in
 *       estimates) — discounts stay 0 until M13;
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
   * Prices a distance + duration for a service type without extras (estimates; M7-shape finals).
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
    return price(
        serviceType,
        currency,
        distanceMeters,
        durationSeconds,
        surchargePercent,
        surgeMultiplier,
        BigDecimal.ZERO,
        BigDecimal.ZERO);
  }

  /**
   * Prices a distance + duration for a service type, with the PRC-03 extras (M8): the wait charge
   * and the pickup-distance fee join the total BEFORE the minimum-fare floor (RIDE-06).
   *
   * @param serviceType the region's service type (its rates and minimum)
   * @param currency the region currency
   * @param distanceMeters routed (estimate) or metered (final) distance
   * @param durationSeconds routed or actual duration
   * @param surchargePercent the time-window surcharge (0 = none)
   * @param surgeMultiplier the locked surge multiplier (≥ 1)
   * @param waitFare the computed wait charge (0 = none)
   * @param pickupFee the computed pickup-distance fee (0 = none)
   * @return every component and the total
   */
  public FareComponentsDto price(
      ServiceType serviceType,
      String currency,
      long distanceMeters,
      long durationSeconds,
      BigDecimal surchargePercent,
      BigDecimal surgeMultiplier,
      BigDecimal waitFare,
      BigDecimal pickupFee) {
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
    BigDecimal wait = money(waitFare);
    BigDecimal pickup = money(pickupFee);
    BigDecimal beforeFloor = subtotal.add(surcharge).add(surge).add(wait).add(pickup);
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
        wait,
        pickup,
        topUp,
        zero,
        beforeFloor.add(topUp));
  }

  /**
   * M13 (GRW-02, owner ruling 2026-10-18): the promo discount joins LAST — after extras, surge and
   * the minimum-fare floor — clamped so the total never goes below zero.
   *
   * @param components the priced components (discount 0)
   * @param discount the promo discount to apply
   * @return the components with the discount recorded and the total reduced
   */
  public static FareComponentsDto applyDiscount(FareComponentsDto components, BigDecimal discount) {
    BigDecimal applied = money(discount.min(components.total()));
    if (applied.signum() <= 0) {
      return components;
    }
    return new FareComponentsDto(
        components.currency(),
        components.baseFare(),
        components.distanceFare(),
        components.timeFare(),
        components.surchargePercent(),
        components.surchargeAmount(),
        components.surgeMultiplier(),
        components.surgeAmount(),
        components.waitFare(),
        components.pickupFee(),
        components.minimumFareAdjustment(),
        applied,
        components.total().subtract(applied));
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
    return TimeWindows.covers(
        window.getDaysOfWeek(), window.getStartsAt(), window.getEndsAt(), local);
  }

  private static BigDecimal money(BigDecimal value) {
    return value.setScale(2, RoundingMode.HALF_UP);
  }
}
