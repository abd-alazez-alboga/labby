package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.runner.DevDataSeeder;
import com.labby.backend.runner.DevDriverSeeder;
import com.labby.backend.runner.DevRegionSeeder;
import com.labby.backend.service.OperatingCalendar;
import com.labby.backend.service.StorageProvider;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * M5-T5 acceptance (seed side): the approved demo drivers seed reproducibly — each is a fully
 * onboarded driver (approved application with history, active driver role, exactly one active
 * approved vehicle with Damascus service types, four approved current documents whose files exist
 * in private storage), the M2 fixture {@code +963900000002} is backfilled, one insurance sits
 * inside the 30-day expiry horizon, and a second run changes nothing. The seeders are dev-profile
 * only, so the test constructs them directly.
 */
class DevDriverSeederIntegrationTest extends AbstractIntegrationTest {

  private static final String SEEDED_PHONES =
      "('+963900000001', '+963900000002', '+963900000003', '+963900000004', '+963900000005',"
          + " '+963900000006', '+963900000007')";
  private static final String SEEDED_USERS =
      "(SELECT user_id FROM users WHERE phone IN " + SEEDED_PHONES + ")";
  private static final String DEMO_DRIVER_PHONES =
      "('+963900000002', '+963900000005', '+963900000006', '+963900000007')";

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private StorageProvider storageProvider;
  @Autowired private OperatingCalendar operatingCalendar;

  @AfterEach
  void cleanOwnRows() {
    jdbcTemplate.update("DELETE FROM documents WHERE driver_user_id IN " + SEEDED_USERS);
    jdbcTemplate.update(
        "DELETE FROM vehicle_photos WHERE vehicle_id IN (SELECT vehicle_id FROM vehicles WHERE"
            + " driver_user_id IN "
            + SEEDED_USERS
            + ")");
    jdbcTemplate.update(
        "DELETE FROM vehicle_service_types WHERE vehicle_id IN (SELECT vehicle_id FROM vehicles"
            + " WHERE driver_user_id IN "
            + SEEDED_USERS
            + ")");
    jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id IN " + SEEDED_USERS);
    jdbcTemplate.update(
        "DELETE FROM driver_application_events WHERE driver_profile_id IN (SELECT"
            + " driver_profile_id FROM driver_profiles WHERE user_id IN "
            + SEEDED_USERS
            + ")");
    jdbcTemplate.update("DELETE FROM driver_profiles WHERE user_id IN " + SEEDED_USERS);
    jdbcTemplate.update("DELETE FROM stored_files WHERE owner_user_id IN " + SEEDED_USERS);
    jdbcTemplate.update("DELETE FROM role_assignments WHERE user_id IN " + SEEDED_USERS);
    jdbcTemplate.update("DELETE FROM users WHERE phone IN " + SEEDED_PHONES);
    String damascus = "(SELECT region_id FROM regions WHERE name = 'Damascus')";
    jdbcTemplate.update("DELETE FROM surge_zones WHERE region_id IN " + damascus);
    jdbcTemplate.update("DELETE FROM surcharge_windows WHERE region_id IN " + damascus);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id IN " + damascus);
    jdbcTemplate.update("DELETE FROM regions WHERE name = 'Damascus'");
  }

  @Test
  @DisplayName("seeding twice yields four fully onboarded Damascus demo drivers, unchanged")
  void shouldSeedApprovedDemoDriversReproducibly() {
    runAllSeeders();
    Map<String, Integer> firstRun = rowCounts();
    runAllSeeders();

    assertThat(rowCounts()).isEqualTo(firstRun);
    assertThat(firstRun)
        .containsEntry("driver_profiles", 4)
        .containsEntry("vehicles", 4)
        .containsEntry("documents", 16)
        .containsEntry("vehicle_photos", 8);

    assertThat(
            count(
                "driver_profiles p JOIN users u ON u.user_id = p.user_id",
                "u.phone IN "
                    + DEMO_DRIVER_PHONES
                    + " AND p.application_status = 'approved'"
                    + " AND p.personal_review_status = 'approved'"))
        .isEqualTo(4);
    assertThat(
            count(
                "role_assignments r JOIN users u ON u.user_id = r.user_id",
                "u.phone IN "
                    + DEMO_DRIVER_PHONES
                    + " AND r.role = 'driver' AND r.state = 'active'"))
        .isEqualTo(4);
    // Exactly one active approved vehicle per demo driver, each serving >= 1 Damascus type.
    assertThat(
            count(
                "vehicles v JOIN users u ON u.user_id = v.driver_user_id",
                "u.phone IN "
                    + DEMO_DRIVER_PHONES
                    + " AND v.is_active AND v.review_status = 'approved'"))
        .isEqualTo(4);
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT count(*) FROM vehicle_service_types vst"
                    + " JOIN service_types st ON st.service_type_id = vst.service_type_id"
                    + " JOIN regions r ON r.region_id = st.region_id AND r.name = 'Damascus'"
                    + " GROUP BY vst.vehicle_id",
                Long.class))
        .hasSize(4)
        .allMatch(types -> types >= 1);
    // Four approved current documents each, every file present in private storage.
    assertThat(
            count("documents", "review_status = 'approved' AND driver_user_id IN " + SEEDED_USERS))
        .isEqualTo(16);
    List<String> keys =
        jdbcTemplate.queryForList(
            "SELECT storage_key FROM stored_files WHERE owner_user_id IN " + SEEDED_USERS,
            String.class);
    assertThat(keys).hasSize(24);
    keys.forEach(key -> assertThat(storageProvider.load(key)).isNotEmpty());
    // The demo insurance inside the 30-day horizon feeds the expiry dashboard (UC-A-12).
    LocalDate today = operatingCalendar.today();
    assertThat(
            count(
                "documents d JOIN users u ON u.user_id = d.driver_user_id",
                "u.phone = '+963900000006' AND d.type = 'insurance' AND d.expires_on = '"
                    + today.plusDays(20)
                    + "'"))
        .isEqualTo(1);
    // The M2 fixture keeps its original account; new demo drivers carry a profile photo.
    assertThat(count("users", "phone = '+963900000002' AND name = 'Dev Driver'")).isEqualTo(1);
    assertThat(
            count(
                "users",
                "phone IN ('+963900000005', '+963900000006', '+963900000007')"
                    + " AND photo_path IS NOT NULL"))
        .isEqualTo(3);
  }

  private void runAllSeeders() {
    new DevDataSeeder(jdbcTemplate, passwordEncoder).run(null);
    new DevRegionSeeder(jdbcTemplate).run(null);
    new DevDriverSeeder(jdbcTemplate, passwordEncoder, storageProvider, operatingCalendar)
        .run(null);
  }

  private Map<String, Integer> rowCounts() {
    return Map.of(
        "driver_profiles", count("driver_profiles", "user_id IN " + SEEDED_USERS),
        "vehicles", count("vehicles", "driver_user_id IN " + SEEDED_USERS),
        "documents", count("documents", "driver_user_id IN " + SEEDED_USERS),
        "vehicle_photos",
            count(
                "vehicle_photos",
                "vehicle_id IN (SELECT vehicle_id FROM vehicles WHERE driver_user_id IN "
                    + SEEDED_USERS
                    + ")"),
        "stored_files", count("stored_files", "owner_user_id IN " + SEEDED_USERS),
        "users", count("users", "phone IN " + SEEDED_PHONES));
  }

  private int count(String from, String where) {
    Integer value =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM " + from + " WHERE " + where, Integer.class);
    return value == null ? 0 : value;
  }
}
