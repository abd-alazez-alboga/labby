package com.labby.backend.service;

import com.labby.backend.config.AnalyticsProperties;
import com.labby.backend.dto.AnalyticsDashboardDto;
import com.labby.backend.dto.AnalyticsDashboardDto.DailyRidesDto;
import com.labby.backend.dto.AnalyticsDashboardDto.OpsMetricsDto;
import com.labby.backend.dto.AnalyticsDashboardDto.RegionRevenueDto;
import com.labby.backend.dto.AnalyticsDashboardDto.RegionRidesDto;
import com.labby.backend.dto.AnalyticsDashboardDto.RevenueMetricsDto;
import com.labby.backend.dto.AnalyticsDashboardDto.RevenueRowDto;
import com.labby.backend.dto.AnalyticsDashboardDto.RideMetricsDto;
import com.labby.backend.dto.AnalyticsDashboardDto.ServiceTypeRidesDto;
import com.labby.backend.dto.AnalyticsDashboardDto.SignupsDto;
import com.labby.backend.dto.AnalyticsDashboardDto.UserMetricsDto;
import com.labby.backend.enums.AnalyticsScope;
import com.labby.backend.enums.RideState;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.repository.AnalyticsRepository;
import com.labby.backend.repository.AnalyticsRepository.OfferCounts;
import com.labby.backend.repository.AnalyticsRepository.RegionRevenue;
import com.labby.backend.repository.AnalyticsRepository.RideStateCount;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Formulas per analytics-v1.yaml (owner rulings 2026-10-20). Every statement runs under the
 * configured {@code statement_timeout}; rates round HALF_UP to 4 decimals.
 */
@Service
@RequiredArgsConstructor
public class AnalyticsServiceImpl implements AnalyticsService {

  private final AnalyticsRepository analyticsRepository;
  private final AnalyticsProperties analyticsProperties;

  @Override
  @Transactional(readOnly = true)
  public AnalyticsDashboardDto dashboard(Instant from, Instant to, UUID regionId) {
    if (!to.isAfter(from)) {
      throw new InvalidRequestException("'to' must be after 'from'").withCode("invalid_range");
    }
    if (Duration.between(from, to).compareTo(Duration.ofDays(MAX_RANGE_DAYS)) > 0) {
      throw new InvalidRequestException("The range may span at most " + MAX_RANGE_DAYS + " days")
          .withCode("range_too_long");
    }
    analyticsRepository.limitStatementTime(analyticsProperties.statementTimeout());
    return new AnalyticsDashboardDto(
        from,
        to,
        regionId,
        rides(from, to, regionId),
        revenue(analyticsRepository.regionRevenue(from, to, regionId)),
        users(from, to, regionId),
        ops(from, to, regionId));
  }

  private RideMetricsDto rides(Instant from, Instant to, UUID regionId) {
    List<RideStateCount> counts = analyticsRepository.rideStateCounts(from, to, regionId);
    long total = 0;
    long completed = 0;
    long byRider = 0;
    long byDriver = 0;
    long noDriver = 0;
    Map<UUID, long[]> regions = new LinkedHashMap<>();
    Map<UUID, String> regionNames = new LinkedHashMap<>();
    Map<UUID, long[]> serviceTypes = new LinkedHashMap<>();
    Map<UUID, RideStateCount> serviceTypeInfo = new LinkedHashMap<>();
    for (RideStateCount count : counts) {
      RideState state = RideState.fromValue(count.state());
      long n = count.count();
      total += n;
      completed += state == RideState.COMPLETED ? n : 0;
      byRider += state == RideState.CANCELLED_BY_RIDER ? n : 0;
      byDriver += state == RideState.CANCELLED_BY_DRIVER ? n : 0;
      noDriver += state == RideState.NO_DRIVER_FOUND ? n : 0;
      long[] region = regions.computeIfAbsent(count.regionId(), id -> new long[3]);
      regionNames.put(count.regionId(), count.regionName());
      region[0] += n;
      region[1] += state == RideState.COMPLETED ? n : 0;
      region[2] += isCancelled(state) ? n : 0;
      long[] serviceType = serviceTypes.computeIfAbsent(count.serviceTypeId(), id -> new long[2]);
      serviceTypeInfo.put(count.serviceTypeId(), count);
      serviceType[0] += n;
      serviceType[1] += state == RideState.COMPLETED ? n : 0;
    }
    List<RegionRidesDto> byRegion = new ArrayList<>();
    regions.forEach(
        (id, c) -> byRegion.add(new RegionRidesDto(id, regionNames.get(id), c[0], c[1], c[2])));
    byRegion.sort(
        Comparator.comparing(RegionRidesDto::regionName)
            .thenComparing(row -> row.regionId().toString()));
    List<ServiceTypeRidesDto> byServiceType = new ArrayList<>();
    serviceTypes.forEach(
        (id, c) -> {
          RideStateCount info = serviceTypeInfo.get(id);
          byServiceType.add(
              new ServiceTypeRidesDto(
                  id,
                  info.regionId(),
                  info.serviceTypeNameEn(),
                  info.serviceTypeNameAr(),
                  c[0],
                  c[1]));
        });
    byServiceType.sort(
        Comparator.comparing((ServiceTypeRidesDto row) -> regionNames.get(row.regionId()))
            .thenComparing(ServiceTypeRidesDto::nameEn)
            .thenComparing(row -> row.serviceTypeId().toString()));
    List<DailyRidesDto> daily =
        analyticsRepository.dailyCounts(from, to, regionId).stream()
            .map(
                day -> new DailyRidesDto(day.date(), day.total(), day.completed(), day.cancelled()))
            .toList();
    long finished = completed + byRider + byDriver + noDriver;
    return new RideMetricsDto(
        total,
        completed,
        byRider,
        byDriver,
        noDriver,
        rate(completed, finished),
        byRegion,
        byServiceType,
        daily);
  }

  private static RevenueMetricsDto revenue(List<RegionRevenue> rows) {
    Map<String, BigDecimal[]> totals = new TreeMap<>();
    List<RegionRevenueDto> byRegion = new ArrayList<>();
    for (RegionRevenue row : rows) {
      BigDecimal[] total =
          totals.computeIfAbsent(row.currency(), c -> new BigDecimal[] {money(0), money(0)});
      total[0] = total[0].add(row.grossFares());
      total[1] = total[1].add(row.commission());
      byRegion.add(
          new RegionRevenueDto(
              row.regionId(),
              row.regionName(),
              row.currency(),
              scaled(row.grossFares()),
              scaled(row.commission())));
    }
    List<RevenueRowDto> totalRows = new ArrayList<>();
    totals.forEach(
        (currency, sums) ->
            totalRows.add(new RevenueRowDto(currency, scaled(sums[0]), scaled(sums[1]))));
    return new RevenueMetricsDto(totalRows, byRegion);
  }

  private UserMetricsDto users(Instant from, Instant to, UUID regionId) {
    AnalyticsRepository.Signups signups = analyticsRepository.signups(from, to);
    AnalyticsRepository.ActiveParties active =
        analyticsRepository.activeParties(from, to, regionId);
    return new UserMetricsDto(
        new SignupsDto(AnalyticsScope.PLATFORM, signups.riders(), signups.drivers()),
        active.riders(),
        active.drivers(),
        analyticsRepository.driversOnlineNow(regionId));
  }

  private OpsMetricsDto ops(Instant from, Instant to, UUID regionId) {
    BigDecimal pickup = analyticsRepository.avgPickupSeconds(from, to, regionId);
    OfferCounts offers = analyticsRepository.offerCounts(from, to, regionId);
    return new OpsMetricsDto(
        pickup == null ? null : pickup.setScale(0, RoundingMode.HALF_UP).longValueExact(),
        rate(offers.accepted(), offers.answered()),
        offers.accepted(),
        offers.answered(),
        analyticsRepository.activeSurgeZones(regionId));
  }

  private static boolean isCancelled(RideState state) {
    return state == RideState.CANCELLED_BY_RIDER || state == RideState.CANCELLED_BY_DRIVER;
  }

  private static BigDecimal rate(long part, long whole) {
    return whole == 0
        ? null
        : BigDecimal.valueOf(part).divide(BigDecimal.valueOf(whole), 4, RoundingMode.HALF_UP);
  }

  private static BigDecimal money(long value) {
    return BigDecimal.valueOf(value);
  }

  private static BigDecimal scaled(BigDecimal amount) {
    return amount.setScale(2, RoundingMode.HALF_UP);
  }
}
