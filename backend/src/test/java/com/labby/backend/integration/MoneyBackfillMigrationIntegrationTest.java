package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * M8 audit W4: the V12 rider-dues BACKFILL on real M7 data. A scratch database on the shared
 * Testcontainer is migrated to V11, seeded with M7-shaped rides (a rider-cancel fee, a no-show fee,
 * a free cancellation, a completed ride), then migrated to V12: exactly the two recorded fees
 * become pending dues with the ride's amount, currency, rider and source ride.
 */
class MoneyBackfillMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final String SCRATCH_DB = "labby_v12_backfill";

  @Autowired private JdbcTemplate jdbcTemplate;

  @Value("${spring.datasource.username}")
  private String username;

  @Value("${spring.datasource.password}")
  private String password;

  private String scratchUrl;
  private JdbcTemplate scratch;

  @BeforeEach
  void createScratchDatabase() {
    jdbcTemplate.execute("DROP DATABASE IF EXISTS " + SCRATCH_DB + " WITH (FORCE)");
    jdbcTemplate.execute("CREATE DATABASE " + SCRATCH_DB);
    String url =
        jdbcTemplate.execute(
            (ConnectionCallback<String>) connection -> connection.getMetaData().getURL());
    scratchUrl = url.replaceFirst("/[^/?]+(\\?|$)", "/" + SCRATCH_DB + "$1");
    scratch = new JdbcTemplate(new DriverManagerDataSource(scratchUrl, username, password));
  }

  @AfterEach
  void dropScratchDatabase() {
    jdbcTemplate.execute("DROP DATABASE IF EXISTS " + SCRATCH_DB + " WITH (FORCE)");
  }

  private Flyway flyway(String target) {
    return Flyway.configure()
        .dataSource(scratchUrl, username, password)
        .locations("classpath:db/migration")
        .target(target)
        .load();
  }

  @Test
  @DisplayName("V12 turns exactly the M7-recorded cancellation fees into pending rider dues")
  void shouldBackfillRecordedFeesAsPendingDues() {
    flyway("11").migrate();

    UUID rider = user("+963937000101");
    UUID noShowRider = user("+963937000102");
    UUID freeRider = user("+963937000103");
    UUID driver = user("+963937000104");
    UUID vehicle = UUID.randomUUID();
    scratch.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'BF-1', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
    UUID region = UUID.randomUUID();
    scratch.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, 'Backfill', 'SYP')", region);
    UUID serviceType = UUID.randomUUID();
    scratch.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceType,
        region);

    UUID riderCancel =
        ride(
            rider,
            region,
            serviceType,
            "state = 'cancelled_by_rider', cancelled_at = now(), cancellation_reason ="
                + " 'changed_mind', cancellation_fee = 2.00");
    UUID noShow =
        ride(
            noShowRider,
            region,
            serviceType,
            "state = 'cancelled_by_driver', accepted_at = now(), driver_user_id = '"
                + driver
                + "', vehicle_id = '"
                + vehicle
                + "', driver_arrived_at = now(), cancelled_at = now(), cancellation_reason ="
                + " 'rider_no_show', cancellation_fee = 2.00");
    ride(
        freeRider,
        region,
        serviceType,
        "state = 'cancelled_by_rider', cancelled_at = now(), cancellation_reason = 'changed_mind'");
    ride(
        rider,
        region,
        serviceType,
        "state = 'completed', offering_at = now(), accepted_at = now(), started_at = now(),"
            + " completed_at = now(), driver_user_id = '"
            + driver
            + "', vehicle_id = '"
            + vehicle
            + "', payment_status = 'pending'");

    flyway("12").migrate();

    List<Map<String, Object>> dues =
        scratch.queryForList(
            "SELECT rider_user_id, currency, amount, type, source_ride_id, status,"
                + " collected_ride_id, collected_at FROM rider_dues ORDER BY amount, rider_user_id");
    assertThat(dues).hasSize(2);
    assertThat(dues)
        .extracting(due -> due.get("source_ride_id"))
        .containsExactlyInAnyOrder(riderCancel, noShow);
    for (Map<String, Object> due : dues) {
      UUID expectedRider = riderCancel.equals(due.get("source_ride_id")) ? rider : noShowRider;
      assertThat(due.get("rider_user_id")).isEqualTo(expectedRider);
      assertThat(due.get("currency")).isEqualTo("SYP");
      assertThat((BigDecimal) due.get("amount")).isEqualByComparingTo("2.00");
      assertThat(due.get("type")).isEqualTo("cancellation_fee");
      assertThat(due.get("status")).isEqualTo("pending");
      assertThat(due.get("collected_ride_id")).isNull();
      assertThat(due.get("collected_at")).isNull();
    }
    // Nothing was debited or credited for them: the ledgers start empty.
    assertThat(scratch.queryForObject("SELECT count(*) FROM driver_ledger", Integer.class))
        .isZero();
    assertThat(scratch.queryForObject("SELECT count(*) FROM wallet_transactions", Integer.class))
        .isZero();
  }

  private UUID user(String phone) {
    UUID userId = UUID.randomUUID();
    scratch.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Backfill User', now())",
        userId,
        phone);
    return userId;
  }

  /** A requested ride, then moved to its final state in one UPDATE (the CHECKs see the end). */
  private UUID ride(UUID riderId, UUID regionId, UUID serviceTypeId, String finalState) {
    UUID rideId = UUID.randomUUID();
    scratch.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, pickup,"
            + " destination, payment_method, pickup_distance_mode, currency, estimate_total,"
            + " estimate_distance_m, estimate_duration_s, estimate_components) VALUES (?, ?, ?, ?,"
            + " ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId);
    scratch.update("UPDATE rides SET " + finalState + " WHERE ride_id = ?", rideId);
    return rideId;
  }
}
