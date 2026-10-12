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
 * COM-02: the rate applied to a completion is the driver's weekly rate row for the ride's region
 * (Monday-start week in the region's time zone). The row is computed from the PREVIOUS week's
 * completed trips in that region — by the weekly recalc, or lazily by the first completion of the
 * week when the job has not run yet (M8 audit W1); both insert idempotently (the unique constraint
 * keeps an existing row), so the job is only a pre-warm and never decides the rate alone.
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
  @Transactional
  public BigDecimal ratePercent(UUID driverUserId, Region region, Instant at) {
    ZoneId zone = ZoneId.of(region.getTimeZone());
    LocalDate weekStart = CommissionPolicy.weekStart(at, zone);
    Optional<DriverCommissionRate> stored =
        driverCommissionRateRepository.findByDriverUserIdAndRegionIdAndWeekStart(
            driverUserId, region.getId(), weekStart);
    if (stored.isPresent()) {
      return stored.get().getPercent();
    }
    WeekRate computed = computeWeekRate(driverUserId, region, weekStart, zone);
    driverCommissionRateRepository.insertIfAbsent(
        driverUserId,
        region.getId(),
        weekStart,
        computed.percent(),
        computed.weeklyTrips(),
        clock.instant());
    // A concurrent writer (the job, another completion) may have won the insert: read the row.
    return driverCommissionRateRepository
        .findByDriverUserIdAndRegionIdAndWeekStart(driverUserId, region.getId(), weekStart)
        .map(DriverCommissionRate::getPercent)
        .orElse(computed.percent());
  }

  @Override
  @Transactional(readOnly = true)
  public CommissionStatusDto status(UUID driverUserId, Region region, Instant at) {
    ZoneId zone = ZoneId.of(region.getTimeZone());
    LocalDate weekStart = CommissionPolicy.weekStart(at, zone);
    List<CommissionPolicy.Tier> tiers = commissionPolicy.tiers(region);
    // The stored row, else exactly what the week's first completion will store (no write here).
    WeekRate rate =
        driverCommissionRateRepository
            .findByDriverUserIdAndRegionIdAndWeekStart(driverUserId, region.getId(), weekStart)
            .map(row -> new WeekRate(row.getPercent(), row.getWeeklyTrips()))
            .orElseGet(() -> computeWeekRate(driverUserId, region, weekStart, zone));
    int currentWeekTrips =
        completedTrips(driverUserId, region.getId(), weekStart, weekStart.plusDays(7), zone);
    NextTierDto nextTier =
        commissionPolicy
            .nextTier(currentWeekTrips, tiers)
            .map(tier -> new NextTierDto(tier.percent(), tier.weeklyTripsAbove()))
            .orElse(null);
    return new CommissionStatusDto(
        rate.percent(), weekStart, rate.weeklyTrips(), currentWeekTrips, nextTier);
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

  /** The week's rate from the previous week's completed trips in the region (the recalc rule). */
  private WeekRate computeWeekRate(
      UUID driverUserId, Region region, LocalDate weekStart, ZoneId zone) {
    int trips =
        completedTrips(driverUserId, region.getId(), weekStart.minusDays(7), weekStart, zone);
    return new WeekRate(commissionPolicy.percentFor(trips, commissionPolicy.tiers(region)), trips);
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

  /** A week's rate and the previous-week trip count it came from. */
  private record WeekRate(BigDecimal percent, int weeklyTrips) {}
}
