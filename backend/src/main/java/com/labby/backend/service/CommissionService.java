package com.labby.backend.service;

import com.labby.backend.dto.CommissionStatusDto;
import com.labby.backend.model.Region;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** The weekly tiered commission (COM-02): rate resolution, status and the weekly recalc. */
public interface CommissionService {

  /**
   * The driver's rate percent for the week containing {@code at} in the region: the stored weekly
   * rate row, or the region's base tier when none exists.
   *
   * @param driverUserId the driver
   * @param region the ride's region
   * @param at the moment (completion time)
   * @return the percent
   */
  BigDecimal ratePercent(UUID driverUserId, Region region, Instant at);

  /**
   * The driver's current rate and next-tier progress in a region (UC-D-15).
   *
   * @param driverUserId the driver
   * @param region the operating region
   * @param at the moment
   * @return the status
   */
  CommissionStatusDto status(UUID driverUserId, Region region, Instant at);

  /**
   * One weekly recalc pass: per region (its time zone), computes each driver's rate from the
   * PREVIOUS Monday-start week's completed trips in that region and inserts the current week's rate
   * rows idempotently (existing rows are kept).
   *
   * @return how many rate rows were inserted
   */
  int recalcWeeklyRates();
}
