package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.RegionState;
import com.labby.backend.model.Region;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SurchargeWindow;
import com.labby.backend.model.SurgeZone;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.repository.ServiceTypeRepository;
import com.labby.backend.repository.SurchargeWindowRepository;
import com.labby.backend.repository.SurgeZoneRepository;
import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M4-T1 acceptance: V5 migrates cleanly on the PostGIS image (context boot), the geometry columns
 * carry SRID 4326, point-in-region and point-in-zone queries are correct (including the pinned
 * ON-boundary behavior: ST_Covers, a boundary point counts as inside), draft regions never resolve,
 * and the JSONB bundle parts round-trip through the entities.
 */
class RegionsMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final GeometryFactory GEOMETRY_FACTORY =
      new GeometryFactory(new PrecisionModel(), 4326);

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private RegionRepository regionRepository;
  @Autowired private ServiceTypeRepository serviceTypeRepository;
  @Autowired private SurchargeWindowRepository surchargeWindowRepository;
  @Autowired private SurgeZoneRepository surgeZoneRepository;

  @AfterEach
  void cleanOwnRows() {
    surgeZoneRepository.deleteAll();
    surchargeWindowRepository.deleteAll();
    serviceTypeRepository.deleteAll();
    regionRepository.deleteAll();
  }

  @Test
  @DisplayName("PostGIS is enabled and the region tables carry SRID-4326 geometry columns")
  void shouldMigrateGeometrySchema() {
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM pg_extension WHERE extname = 'postgis'", Integer.class))
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT srid FROM geometry_columns WHERE f_table_name = 'regions'"
                    + " AND f_geometry_column = 'boundary'",
                Integer.class))
        .isEqualTo(4326);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT srid FROM geometry_columns WHERE f_table_name = 'surge_zones'"
                    + " AND f_geometry_column = 'polygon'",
                Integer.class))
        .isEqualTo(4326);
  }

  @Test
  @DisplayName("point-in-region: inside resolves, outside and drafts do not, boundary is inside")
  void shouldFindRegionCoveringPoint() {
    Region active =
        regionRepository.save(
            Region.builder()
                .name("Damascus")
                .state(RegionState.ACTIVE)
                .boundary(square(36.0, 33.0, 36.5, 33.5))
                .build());
    regionRepository.save(
        Region.builder()
            .name("Draft City")
            .state(RegionState.DRAFT)
            .boundary(square(37.0, 33.0, 37.5, 33.5))
            .build());

    List<Region> inside = regionRepository.findActiveRegionsCovering(33.25, 36.25);
    assertThat(inside).extracting(Region::getId).containsExactly(active.getId());

    assertThat(regionRepository.findActiveRegionsCovering(34.0, 36.25)).isEmpty();

    // Draft regions never resolve, even for a point inside their boundary.
    assertThat(regionRepository.findActiveRegionsCovering(33.25, 37.25)).isEmpty();

    // Pinned ON-boundary behavior: a point exactly on the edge counts as inside (ST_Covers).
    assertThat(regionRepository.findActiveRegionsCovering(33.0, 36.25))
        .extracting(Region::getId)
        .containsExactly(active.getId());
  }

  @Test
  @DisplayName("point-in-zone: scoped to the zone's region, boundary inside, elsewhere empty")
  void shouldFindZonesCoveringPoint() {
    Region region =
        regionRepository.save(
            Region.builder()
                .name("Aleppo")
                .state(RegionState.ACTIVE)
                .boundary(square(37.0, 36.0, 37.5, 36.5))
                .build());
    Region otherRegion =
        regionRepository.save(
            Region.builder()
                .name("Homs")
                .state(RegionState.ACTIVE)
                .boundary(square(36.0, 34.0, 36.5, 34.5))
                .build());
    SurgeZone zone =
        surgeZoneRepository.save(
            SurgeZone.builder()
                .regionId(region.getId())
                .name("Old City")
                .polygon(square(37.1, 36.1, 37.2, 36.2))
                .thresholdSteps(
                    List.of(
                        Map.of("ratio", 2, "multiplier", 1.2),
                        Map.of("ratio", 3, "multiplier", 1.5),
                        Map.of("ratio", 5, "multiplier", 2.0)))
                .multiplierCap(new BigDecimal("2.50"))
                .build());

    List<SurgeZone> covering = surgeZoneRepository.findZonesCovering(region.getId(), 36.15, 37.15);
    assertThat(covering).extracting(SurgeZone::getId).containsExactly(zone.getId());

    // In the region but outside every zone -> empty (PRC-02 A1: 1.0x).
    assertThat(surgeZoneRepository.findZonesCovering(region.getId(), 36.4, 37.4)).isEmpty();

    // The same point queried against another region finds nothing: zones are region-scoped.
    assertThat(surgeZoneRepository.findZonesCovering(otherRegion.getId(), 36.15, 37.15)).isEmpty();

    // Zone edge counts as inside the zone.
    assertThat(surgeZoneRepository.findZonesCovering(region.getId(), 36.1, 37.15))
        .extracting(SurgeZone::getId)
        .containsExactly(zone.getId());
  }

  @Test
  @DisplayName("the settings bundle, service types and surcharge windows round-trip")
  void shouldRoundTripConfigBundle() {
    Region saved =
        regionRepository.save(
            Region.builder()
                .name("Latakia")
                .currency("SYP")
                .emergencyNumber("112")
                .cancellationGraceMin(5)
                .cancellationFee(new BigDecimal("1.00"))
                .waitGraceMin(5)
                .waitPerMinRate(new BigDecimal("0.25"))
                .pickupFeeThresholdKm(new BigDecimal("10.0"))
                .pickupFeePerKm(new BigDecimal("0.50"))
                .surgeCap(new BigDecimal("3.00"))
                .commissionTiers(
                    List.of(
                        Map.of("weeklyTripsAbove", 0, "percent", 25),
                        Map.of("weeklyTripsAbove", 100, "percent", 20),
                        Map.of("weeklyTripsAbove", 200, "percent", 15)))
                .incentiveValues(
                    Map.of(
                        "weeklyTripBonuses",
                        List.of(Map.of("trips", 40, "amount", 50)),
                        "peakHourBonusPerTrip",
                        1.0,
                        "ratingReward",
                        Map.of("amount", 20, "minAvgRating", 4.8, "minWeeklyTrips", 30)))
                .suspensionThresholds(
                    Map.of(
                        "driver", Map.of("minAvgRating", 3.0, "minRatedRides", 20),
                        "rider", Map.of("minAvgRating", 2.5, "minRatedRides", 10)))
                .build());
    UUID regionId = saved.getId();
    serviceTypeRepository.save(
        ServiceType.builder()
            .regionId(regionId)
            .nameEn("Economy")
            .nameAr("اقتصادي")
            .baseFare(new BigDecimal("1.00"))
            .perKmRate(new BigDecimal("0.30"))
            .perMinRate(new BigDecimal("0.05"))
            .minimumFare(new BigDecimal("1.50"))
            .build());
    surchargeWindowRepository.save(
        SurchargeWindow.builder()
            .regionId(regionId)
            .label("Morning rush")
            .startsAt(LocalTime.of(7, 30))
            .endsAt(LocalTime.of(9, 30))
            .daysOfWeek(List.of(1, 2, 3, 4, 5))
            .percent(new BigDecimal("25.00"))
            .build());

    Region reloaded = regionRepository.findById(regionId).orElseThrow();
    assertThat(reloaded.getState()).isEqualTo(RegionState.DRAFT);
    assertThat(reloaded.getCurrency()).isEqualTo("SYP");
    assertThat(reloaded.getCommissionTiers()).hasSize(3);
    assertThat(reloaded.getCommissionTiers().get(2))
        .containsEntry("weeklyTripsAbove", 200)
        .containsEntry("percent", 15);
    assertThat(reloaded.getIncentiveValues()).containsKey("ratingReward");
    assertThat(reloaded.getSuspensionThresholds()).containsKeys("driver", "rider");

    List<ServiceType> types = serviceTypeRepository.findByRegionIdOrderByNameEnAsc(regionId);
    assertThat(types).hasSize(1);
    assertThat(types.get(0).getNameAr()).isEqualTo("اقتصادي");
    assertThat(types.get(0).getMinimumFare()).isEqualByComparingTo("1.50");
    assertThat(types.get(0).isEnabled()).isTrue();

    List<SurchargeWindow> windows =
        surchargeWindowRepository.findByRegionIdOrderByStartsAtAsc(regionId);
    assertThat(windows).hasSize(1);
    assertThat(windows.get(0).getDaysOfWeek()).containsExactly(1, 2, 3, 4, 5);
    assertThat(windows.get(0).getPercent()).isEqualByComparingTo("25.00");
  }

  private Polygon square(double minLng, double minLat, double maxLng, double maxLat) {
    return GEOMETRY_FACTORY.createPolygon(
        new Coordinate[] {
          new Coordinate(minLng, minLat),
          new Coordinate(maxLng, minLat),
          new Coordinate(maxLng, maxLat),
          new Coordinate(minLng, maxLat),
          new Coordinate(minLng, minLat)
        });
  }
}
