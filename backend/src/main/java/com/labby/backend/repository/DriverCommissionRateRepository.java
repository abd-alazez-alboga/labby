package com.labby.backend.repository;

import com.labby.backend.model.DriverCommissionRate;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Weekly driver commission rates per region (COM-02). */
public interface DriverCommissionRateRepository extends JpaRepository<DriverCommissionRate, UUID> {

  Optional<DriverCommissionRate> findByDriverUserIdAndRegionIdAndWeekStart(
      UUID driverUserId, UUID regionId, LocalDate weekStart);

  /**
   * Inserts a weekly rate row idempotently: an existing (driver, region, week) row is kept
   * untouched (the recalc job may run more than once, COM-02).
   *
   * @return 1 when inserted, 0 when the row already existed
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO driver_commission_rates
              (driver_user_id, region_id, week_start, percent, weekly_trips, computed_at)
          VALUES (:driverUserId, :regionId, :weekStart, :percent, :weeklyTrips, :computedAt)
          ON CONFLICT (driver_user_id, region_id, week_start) DO NOTHING
          """,
      nativeQuery = true)
  int insertIfAbsent(
      @Param("driverUserId") UUID driverUserId,
      @Param("regionId") UUID regionId,
      @Param("weekStart") LocalDate weekStart,
      @Param("percent") java.math.BigDecimal percent,
      @Param("weeklyTrips") int weeklyTrips,
      @Param("computedAt") java.time.Instant computedAt);
}
