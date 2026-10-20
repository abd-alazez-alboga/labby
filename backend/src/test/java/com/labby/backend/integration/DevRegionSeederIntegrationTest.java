package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.model.Region;
import com.labby.backend.repository.RegionRepository;
import com.labby.backend.runner.DevRegionSeeder;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M4-T5 acceptance (seed side): the Damascus demo region seeds reproducibly — a second run changes
 * nothing, the region is ACTIVE and complete, and it resolves at a Damascus GPS point. The seeder
 * is dev-profile-only, so the test constructs it directly, like dev data is exercised elsewhere.
 */
class DevRegionSeederIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private RegionRepository regionRepository;

  @AfterEach
  void cleanOwnRows() {
    jdbcTemplate.update(
        "DELETE FROM surge_zones WHERE region_id IN (SELECT region_id FROM regions WHERE name ="
            + " 'Damascus')");
    jdbcTemplate.update(
        "DELETE FROM surcharge_windows WHERE region_id IN (SELECT region_id FROM regions WHERE"
            + " name = 'Damascus')");
    jdbcTemplate.update(
        "DELETE FROM service_types WHERE region_id IN (SELECT region_id FROM regions WHERE name ="
            + " 'Damascus')");
    jdbcTemplate.update("DELETE FROM regions WHERE name = 'Damascus'");
  }

  @Test
  @DisplayName("seeding twice yields one complete ACTIVE Damascus that resolves by GPS")
  void shouldSeedDamascusReproducibly() {
    DevRegionSeeder seeder = new DevRegionSeeder(jdbcTemplate);
    seeder.run(null);
    seeder.run(null);

    assertThat(count("regions", "name = 'Damascus'")).isEqualTo(1);
    String regionFilter = "region_id IN (SELECT region_id FROM regions WHERE name = 'Damascus')";
    assertThat(count("service_types", regionFilter)).isEqualTo(3);
    assertThat(count("surcharge_windows", regionFilter)).isEqualTo(1);
    assertThat(count("surge_zones", regionFilter)).isEqualTo(3);

    // A central-Damascus GPS point resolves to the seeded ACTIVE region (SD-01).
    List<Region> covering = regionRepository.findActiveRegionsCovering(33.51, 36.29);
    assertThat(covering).extracting(Region::getName).containsExactly("Damascus");
    Region damascus = covering.get(0);
    assertThat(damascus.getCurrency()).isEqualTo("SYP");
    assertThat(damascus.getEmergencyNumber()).isEqualTo("112");
    assertThat(damascus.getCommissionTiers()).hasSize(3);
    assertThat(damascus.getIncentiveValues()).containsKey("ratingReward");
    // Review V1 I29: the DRV-08 / M15-T3 defaults at the SYP scale of the other seeded amounts
    // (x1000): weekly 50 @ 40+ and 100 @ 60+, peak +1.00/trip, rating reward 20 @ 4.8 / 30 trips.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT incentive_values -> 'weeklyTripBonuses' = '[{\"trips\": 40, \"amount\":"
                    + " 50000}, {\"trips\": 60, \"amount\": 100000}]'::jsonb AND"
                    + " (incentive_values ->> 'peakHourBonusPerTrip')::numeric = 1000 AND"
                    + " incentive_values -> 'ratingReward' = '{\"amount\": 20000, \"minAvgRating\":"
                    + " 4.8, \"minWeeklyTrips\": 30}'::jsonb FROM regions WHERE name = 'Damascus'",
                Boolean.class))
        .isTrue();
    // A peak bonus above 0 needs a window (incentives-v1 Q1): the A15 board's two windows.
    assertThat((List<?>) damascus.getIncentiveValues().get("peakWindows")).hasSize(2);
    assertThat(damascus.getSuspensionThresholds()).containsKeys("driver", "rider");
    assertThat(damascus.getSurgeCap()).isEqualByComparingTo("2.00");
  }

  private int count(String table, String where) {
    Integer value =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM " + table + " WHERE " + where, Integer.class);
    return value == null ? 0 : value;
  }
}
