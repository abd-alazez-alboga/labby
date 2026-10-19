package com.labby.backend.dto;

import com.labby.backend.enums.AnalyticsScope;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The admin analytics dashboard (analytics-v1 {@code AnalyticsDashboard}, ADM-02, UC-A-30). */
public record AnalyticsDashboardDto(
    Instant from,
    Instant to,
    UUID regionId,
    RideMetricsDto rides,
    RevenueMetricsDto revenue,
    UserMetricsDto users,
    OpsMetricsDto ops) {

  /** Rides requested in the range. */
  public record RideMetricsDto(
      long total,
      long completed,
      long cancelledByRider,
      long cancelledByDriver,
      long noDriverFound,
      BigDecimal completionRate,
      List<RegionRidesDto> byRegion,
      List<ServiceTypeRidesDto> byServiceType,
      List<DailyRidesDto> daily) {}

  /** One region's rides. */
  public record RegionRidesDto(
      UUID regionId, String regionName, long total, long completed, long cancelled) {}

  /** One service type's rides. */
  public record ServiceTypeRidesDto(
      UUID serviceTypeId,
      UUID regionId,
      String nameEn,
      String nameAr,
      long total,
      long completed) {}

  /** One local day's rides. */
  public record DailyRidesDto(LocalDate date, long total, long completed, long cancelled) {}

  /** Fares and commission of the completed rides, per currency. */
  public record RevenueMetricsDto(List<RevenueRowDto> totals, List<RegionRevenueDto> byRegion) {}

  /** One currency's totals. */
  public record RevenueRowDto(String currency, BigDecimal grossFares, BigDecimal commission) {}

  /** One region's totals in one currency. */
  public record RegionRevenueDto(
      UUID regionId,
      String regionName,
      String currency,
      BigDecimal grossFares,
      BigDecimal commission) {}

  /** Signups (platform-wide), active parties and the online drivers now. */
  public record UserMetricsDto(
      SignupsDto signups, long activeRiders, long activeDrivers, long driversOnlineNow) {}

  /** Accounts created in the range, by role held (ruling Q6: never region-filtered). */
  public record SignupsDto(AnalyticsScope scope, long riders, long drivers) {}

  /** Pickup time, offer acceptance and the surge zones active now. */
  public record OpsMetricsDto(
      Long avgPickupSeconds,
      BigDecimal acceptanceRate,
      long offersAccepted,
      long offersAnswered,
      long activeSurgeZones) {}
}
