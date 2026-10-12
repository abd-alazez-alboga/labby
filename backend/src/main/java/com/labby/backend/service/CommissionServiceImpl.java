package com.labby.backend.service;

import com.labby.backend.dto.CommissionStatusDto;
import com.labby.backend.dto.NextTierDto;
import com.labby.backend.enums.RideState;
import com.labby.backend.model.DriverCommissionRate;
import com.labby.backend.model.Region;
import com.labby.backend.repository.DriverCommissionRateRepository;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.RideRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * COM-02: the rate applied to a completion is the driver's stored weekly rate row for the ride's
 * region (Monday-start week in the region's time zone), else the region's base tier. The weekly
 * recalc inserts the current week's rows from the previous week's completed trips, idempotently
 * (the unique constraint keeps existing rows).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommissionServiceImpl implements CommissionService {

  private final DriverCommissionRateRepository driverCommissionRateRepository;
  private final RegionRepository regionRepository;
  private final RideRepository rideRepository;
  private final CommissionPolicy commissionPolicy;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public BigDecimal ratePercent(UUID driverUserId, Region region, Instant at) {
    LocalDate weekStart = CommissionPolicy.weekStart(at, ZoneId.of(region.getTimeZone()));
    return driverCommissionRateRepository
        .findByDriverUserIdAndRegionIdAndWeekStart(driverUserId, region.getId(), weekStart)
        .map(DriverCommissionRate::getPercent)
        .orElseGet(() -> commissionPolicy.baseTier(commissionPolicy.tiers(region)).percent());
  }

  @Override
  @Transactional(readOnly = true)
  public CommissionStatusDto status(UUID driverUserId, Region region, Instant at) {
    ZoneId zone = ZoneId.of(region.getTimeZone());
    LocalDate weekStart = CommissionPolicy.weekStart(at, zone);
    List<CommissionPolicy.Tier> tiers = commissionPolicy.tiers(region);
    Optional<DriverCommissionRate> rate =
        driverCommissionRateRepository.findByDriverUserIdAndRegionIdAndWeekStart(
            driverUserId, region.getId(), weekStart);
    BigDecimal percent =
        rate.map(DriverCommissionRate::getPercent)
            .orElseGet(() -> commissionPolicy.baseTier(tiers).percent());
    int weeklyTrips =
        rate.map(DriverCommissionRate::getWeeklyTrips)
            .orElseGet(
                () ->
                    completedTrips(
                        driverUserId, region.getId(), weekStart.minusDays(7), weekStart, zone));
    int currentWeekTrips =
        completedTrips(driverUserId, region.getId(), weekStart, weekStart.plusDays(7), zone);
    NextTierDto nextTier =
        commissionPolicy
            .nextTier(currentWeekTrips, tiers)
            .map(tier -> new NextTierDto(tier.percent(), tier.weeklyTripsAbove()))
            .orElse(null);
    return new CommissionStatusDto(percent, weekStart, weeklyTrips, currentWeekTrips, nextTier);
  }

  @Override
  @Transactional
  public int recalcWeeklyRates() {
    Instant now = clock.instant();
    int inserted = 0;
    for (Region region : regionRepository.findAll()) {
      ZoneId zone = ZoneId.of(region.getTimeZone());
      LocalDate weekStart = CommissionPolicy.weekStart(now, zone);
      LocalDate previousWeekStart = weekStart.minusDays(7);
      List<CommissionPolicy.Tier> tiers = commissionPolicy.tiers(region);
      for (RideRepository.DriverTripCount count :
          rideRepository.countCompletedTripsByDriver(
              region.getId(),
              previousWeekStart.atStartOfDay(zone).toInstant(),
              weekStart.atStartOfDay(zone).toInstant())) {
        inserted +=
            driverCommissionRateRepository.insertIfAbsent(
                count.getDriverUserId(),
                region.getId(),
                weekStart,
                commissionPolicy.percentFor((int) count.getTrips(), tiers),
                (int) count.getTrips(),
                now);
      }
    }
    if (inserted > 0) {
      log.info("Weekly commission recalc inserted {} rate rows", inserted);
    }
    return inserted;
  }

  private int completedTrips(
      UUID driverUserId, UUID regionId, LocalDate from, LocalDate to, ZoneId zone) {
    return (int)
        rideRepository
            .countByDriverUserIdAndRegionIdAndStateAndCompletedAtGreaterThanEqualAndCompletedAtLessThan(
                driverUserId,
                regionId,
                RideState.COMPLETED,
                from.atStartOfDay(zone).toInstant(),
                to.atStartOfDay(zone).toInstant());
  }
}
