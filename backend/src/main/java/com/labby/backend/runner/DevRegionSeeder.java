package com.labby.backend.runner;

import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dev-profile demo region per backend/docs/SEEDING.md (M4-T5): Damascus — the launch market is
 * Syria, so the demo region is a realistic Syrian city, ACTIVE with a full ADM-01 bundle, three
 * service types (AR-first names), a Sun–Thu morning-rush surcharge (Syrian work week) and three
 * surge zones. Idempotent: skipped entirely once a region named Damascus exists, so admin edits
 * survive restarts. Fare values are demo-realistic SYP figures, tunable in the admin UI. Uses
 * JdbcTemplate like {@link DevDataSeeder} (runner layer stays repository-free per ArchUnit).
 */
@Slf4j
@Component
@Profile("dev")
@RequiredArgsConstructor
public class DevRegionSeeder implements ApplicationRunner {

  private static final String REGION_NAME = "Damascus";

  private static final String BOUNDARY_WKT =
      "POLYGON((36.195 33.555, 36.25 33.58, 36.32 33.575, 36.37 33.545, 36.38 33.49,"
          + " 36.345 33.45, 36.28 33.43, 36.21 33.44, 36.17 33.48, 36.175 33.52,"
          + " 36.195 33.555))";
  private static final String ZONE_CITY_CENTER_WKT =
      "POLYGON((36.28 33.50, 36.32 33.50, 36.32 33.525, 36.28 33.525, 36.28 33.50))";
  private static final String ZONE_MAZZEH_WKT =
      "POLYGON((36.22 33.49, 36.26 33.49, 36.26 33.515, 36.22 33.515, 36.22 33.49))";
  private static final String ZONE_OLD_CITY_WKT =
      "POLYGON((36.325 33.505, 36.345 33.505, 36.345 33.52, 36.325 33.52, 36.325 33.505))";

  private static final String COMMISSION_TIERS =
      "[{\"weeklyTripsAbove\":0,\"percent\":25},{\"weeklyTripsAbove\":100,\"percent\":20},"
          + "{\"weeklyTripsAbove\":200,\"percent\":15}]";
  private static final String INCENTIVE_VALUES =
      "{\"weeklyTripBonuses\":[{\"trips\":40,\"amount\":50000},{\"trips\":60,\"amount\":100000}],"
          + "\"peakHourBonusPerTrip\":1000,"
          + "\"ratingReward\":{\"amount\":20000,\"minAvgRating\":4.8,\"minWeeklyTrips\":30}}";
  private static final String SUSPENSION_THRESHOLDS =
      "{\"driver\":{\"minAvgRating\":3.0,\"minRatedRides\":20},"
          + "\"rider\":{\"minAvgRating\":2.5,\"minRatedRides\":10}}";
  private static final String THRESHOLD_STEPS =
      "[{\"ratio\":2,\"multiplier\":1.2},{\"ratio\":3,\"multiplier\":1.5},"
          + "{\"ratio\":5,\"multiplier\":2.0}]";

  private final JdbcTemplate jdbcTemplate;

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    Integer existing =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM regions WHERE name = ?", Integer.class, REGION_NAME);
    if (existing != null && existing > 0) {
      return;
    }
    UUID regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, boundary, currency, emergency_number, state,"
            + " cancellation_grace_min, cancellation_fee, wait_grace_min, wait_per_min_rate,"
            + " pickup_fee_threshold_km, pickup_fee_per_km, surge_cap, commission_tiers,"
            + " incentive_values, suspension_thresholds) VALUES"
            + " (?, ?, ST_GeomFromText(?, 4326), 'SYP', '112', 'active',"
            + " 5, 5000.00, 5, 500.00, 10.0, 1000.00, 2.00, ?::jsonb, ?::jsonb, ?::jsonb)",
        regionId,
        REGION_NAME,
        BOUNDARY_WKT,
        COMMISSION_TIERS,
        INCENTIVE_VALUES,
        SUSPENSION_THRESHOLDS);

    seedServiceType(regionId, "Economy", "اقتصادي", "10000.00", "2000.00", "300.00", "15000.00");
    seedServiceType(regionId, "Comfort", "مريح", "15000.00", "3000.00", "450.00", "22500.00");
    seedServiceType(regionId, "Family", "عائلي", "20000.00", "4000.00", "600.00", "30000.00");

    // Syrian work week: Sunday–Thursday (ISO days 7,1,2,3,4).
    jdbcTemplate.update(
        "INSERT INTO surcharge_windows (region_id, label, starts_at, ends_at, days_of_week,"
            + " percent) VALUES (?, 'Morning rush', '07:00:00', '09:30:00',"
            + " '[7,1,2,3,4]'::jsonb, 25.00)",
        regionId);

    seedZone(regionId, "City Center", ZONE_CITY_CENTER_WKT);
    seedZone(regionId, "Mazzeh", ZONE_MAZZEH_WKT);
    seedZone(regionId, "Old City", ZONE_OLD_CITY_WKT);

    log.info(
        "Seeded demo region {} (3 service types, 1 surcharge window, 3 surge zones)", REGION_NAME);
  }

  private void seedServiceType(
      UUID regionId,
      String nameEn,
      String nameAr,
      String baseFare,
      String perKm,
      String perMin,
      String minimumFare) {
    jdbcTemplate.update(
        "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
            + " per_min_rate, minimum_fare, enabled) VALUES (?, ?, ?, ?::numeric, ?::numeric,"
            + " ?::numeric, ?::numeric, true)",
        regionId,
        nameEn,
        nameAr,
        baseFare,
        perKm,
        perMin,
        minimumFare);
  }

  private void seedZone(UUID regionId, String name, String polygonWkt) {
    jdbcTemplate.update(
        "INSERT INTO surge_zones (region_id, name, polygon, threshold_steps, multiplier_cap)"
            + " VALUES (?, ?, ST_GeomFromText(?, 4326), ?::jsonb, 2.00)",
        regionId,
        name,
        polygonWkt,
        THRESHOLD_STEPS);
  }
}
