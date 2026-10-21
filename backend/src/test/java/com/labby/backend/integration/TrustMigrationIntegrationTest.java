package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M11-T1 acceptance: V17 migrates cleanly and the trust invariants hold at the DATABASE level —
 * ratings unique per ride x rater side, scored 1..5 and immutable (RATE-01); reports one per ride
 * per reporter, categories per direction, permanent, resolved exactly once with notes (REP-01/02);
 * at most 3 photos per report; one active metric warning per driver x metric (DRV-07); one open
 * flag per user x role x kind, closed only with a note (UC-A-16); the new suspension reasons with
 * the mandatory manual note (USR-04..06); report permissions seeded for Support (RBAC-04).
 */
class TrustMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID rider;
  private UUID driver;
  private UUID admin;
  private UUID vehicle;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Trust IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    rider = newUser();
    driver = newUser();
    admin = newUser();
    vehicle = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'DM-M11', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
  }

  @AfterEach
  void cleanOwnRows() {
    // ratings and reports refuse DELETE by trigger; TRUNCATE bypasses row-level triggers (same
    // approach as sos_events and the money ledgers).
    jdbcTemplate.execute("TRUNCATE rating_growth_evaluations, ratings");
    jdbcTemplate.execute("TRUNCATE report_photos, reports");
    jdbcTemplate.update(
        "DELETE FROM stored_files WHERE owner_user_id = ANY (?)",
        (Object) createdUsers.toArray(new UUID[0]));
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM account_flags WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM driver_metric_warnings WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM rating_snapshots WHERE user_id = ?", userId);
    }
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM role_assignments WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("RATE-01: one rating per ride per rater side, scored 1..5, opposite roles only")
  void shouldEnforceRatingShapeAndUniqueness() {
    UUID ride = insertCompletedRide();
    insertRating(ride, rider, "rider", driver, "driver", 5);
    // The same side rating the same ride again is refused; the other side still rates.
    assertThatThrownBy(() -> insertRating(ride, rider, "rider", driver, "driver", 4))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ratings_ride_rater_rated");
    insertRating(ride, driver, "driver", rider, "rider", 4);
    UUID other = insertCompletedRide();
    for (int score : new int[] {0, 6}) {
      assertThatThrownBy(() -> insertRating(other, rider, "rider", driver, "driver", score))
          .isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("ck_ratings_score");
    }
    // A rider rates the DRIVER role (USR-02 per-role ratings), never another rider.
    assertThatThrownBy(() -> insertRating(other, rider, "rider", driver, "rider", 3))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ratings_rated_role");
    assertThatThrownBy(() -> insertRating(other, rider, "rider", rider, "driver", 3))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ratings_distinct_parties");
  }

  @Test
  @DisplayName("RATE-01: a stored rating can never be updated or deleted")
  void shouldKeepRatingsImmutable() {
    UUID ride = insertCompletedRide();
    UUID rating = insertRating(ride, rider, "rider", driver, "driver", 2);
    for (String mutation : List.of("score = 5", "comment = 'edited'", "created_at = now()")) {
      assertThatThrownBy(
              () ->
                  jdbcTemplate.update(
                      "UPDATE ratings SET " + mutation + " WHERE rating_id = ?", rating))
          .as(mutation)
          .isInstanceOf(DataAccessException.class)
          .hasMessageContaining("immutable");
    }
    assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM ratings WHERE rating_id = ?", rating))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("immutable");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT score FROM ratings WHERE rating_id = ?", Integer.class, rating))
        .isEqualTo(2);
  }

  @Test
  @DisplayName("RATE-02: snapshots hold one sane aggregate per user x role")
  void shouldEnforceSnapshotShape() {
    insertSnapshot(driver, "driver", "4.25", 12);
    assertThatThrownBy(() -> insertSnapshot(driver, "driver", "4.00", 13))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("rating_snapshots_pkey");
    assertThatThrownBy(() -> insertSnapshot(rider, "rider", "0.50", 3))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rating_snapshots_avg");
    assertThatThrownBy(() -> insertSnapshot(rider, "rider", "4.00", 0))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rating_snapshots_count");
    assertThatThrownBy(() -> insertSnapshot(rider, "admin", "4.00", 3))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rating_snapshots_role");
  }

  @Test
  @DisplayName("REP-01: one report per ride per reporter, categories per direction")
  void shouldEnforceReportShape() {
    UUID ride = insertCompletedRide();
    insertReport(ride, rider, "rider", driver, "driver", "unsafe_driving");
    assertThatThrownBy(() -> insertReport(ride, rider, "rider", driver, "driver", "other"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_reports_ride_reporter");
    // The driver reports the rider on the same ride with a driver-side category.
    insertReport(ride, driver, "driver", rider, "rider", "vehicle_damage");
    UUID other = insertCompletedRide();
    // Categories belong to their direction: a rider cannot file vehicle_damage, nor a driver
    // unsafe_driving / vehicle_condition.
    assertThatThrownBy(
            () -> insertReport(other, rider, "rider", driver, "driver", "vehicle_damage"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_reports_category");
    for (String category : List.of("unsafe_driving", "vehicle_condition")) {
      assertThatThrownBy(() -> insertReport(other, driver, "driver", rider, "rider", category))
          .as(category)
          .isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("ck_reports_category");
    }
    assertThatThrownBy(() -> insertReport(other, rider, "rider", driver, "rider", "other"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_reports_reported_role");
  }

  @Test
  @DisplayName("REP-02: reports are permanent, facts immutable, resolved exactly once with notes")
  void shouldEnforceReportLifecycle() {
    UUID report = insertReport(insertCompletedRide(), rider, "rider", driver, "driver", "other");
    assertThatThrownBy(() -> jdbcTemplate.update("DELETE FROM reports WHERE report_id = ?", report))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("permanent");
    for (String mutation :
        List.of("category = 'unsafe_driving'", "description = 'edited'", "created_at = now()")) {
      assertThatThrownBy(
              () ->
                  jdbcTemplate.update(
                      "UPDATE reports SET " + mutation + " WHERE report_id = ?", report))
          .as(mutation)
          .isInstanceOf(DataAccessException.class)
          .hasMessageContaining("immutable");
    }
    // A resolution without notes (or without its resolver) is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE reports SET status = 'substantiated', resolved_by = ?, resolved_at ="
                        + " now() WHERE report_id = ?",
                    admin,
                    report))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_reports_resolution");
    jdbcTemplate.update(
        "UPDATE reports SET status = 'substantiated', resolved_by = ?, resolved_at = now(),"
            + " resolution_note = 'trace confirms' WHERE report_id = ?",
        admin,
        report);
    // Final: no re-resolution, no note edits.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE reports SET status = 'unsubstantiated' WHERE report_id = ?", report))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("final");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE reports SET resolution_note = 'changed' WHERE report_id = ?", report))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("final");
  }

  @Test
  @DisplayName("REP-01: at most 3 photos per report, each file used once, report_photo kind")
  void shouldLimitReportPhotos() {
    UUID report = insertReport(insertCompletedRide(), rider, "rider", driver, "driver", "other");
    for (int position = 0; position < 3; position++) {
      insertReportPhoto(report, position, insertReportFile(rider));
    }
    assertThatThrownBy(() -> insertReportPhoto(report, 3, insertReportFile(rider)))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_report_photos_position");
    assertThatThrownBy(() -> insertReportPhoto(report, 1, insertReportFile(rider)))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("report_photos_pkey");
    UUID other = insertReport(insertCompletedRide(), rider, "rider", driver, "driver", "other");
    UUID used =
        jdbcTemplate.queryForObject(
            "SELECT stored_file_id FROM report_photos WHERE report_id = ? AND position = 0",
            UUID.class,
            report);
    assertThatThrownBy(() -> insertReportPhoto(other, 0, used))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_report_photos_file");
    // Report photos are images only (the documents-only PDF rule applies).
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO stored_files (owner_user_id, kind, storage_key, content_type,"
                        + " size_bytes) VALUES (?, 'report_photo', ?, 'application/pdf', 10)",
                    rider,
                    "it/" + UUID.randomUUID()))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_stored_files_pdf_documents_only");
  }

  @Test
  @DisplayName("DRV-07: one active warning per driver x metric; cleared ones are history")
  void shouldEnforceMetricWarnings() {
    UUID first = insertWarning("cancellation");
    assertThatThrownBy(() -> insertWarning("cancellation"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_metric_warnings_active");
    insertWarning("acceptance");
    jdbcTemplate.update(
        "UPDATE driver_metric_warnings SET cleared_at = now() WHERE driver_metric_warning_id = ?",
        first);
    insertWarning("cancellation");
    assertThatThrownBy(() -> insertWarning("on_time"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_metric_warnings_metric");
  }

  @Test
  @DisplayName("UC-A-16: one open flag per user x role x kind, closed only with resolver + note")
  void shouldEnforceFlagLifecycle() {
    UUID flag = insertFlag(driver, "driver", "low_rating");
    assertThatThrownBy(() -> insertFlag(driver, "driver", "low_rating"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_account_flags_open");
    insertFlag(driver, "driver", "report_threshold");
    insertFlag(driver, "rider", "low_rating");
    // Metric warnings are a driver matter only.
    assertThatThrownBy(() -> insertFlag(rider, "rider", "metric_warning"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_account_flags_metric_driver");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE account_flags SET status = 'dismissed', resolved_by = ?, resolved_at ="
                        + " now() WHERE account_flag_id = ?",
                    admin,
                    flag))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_account_flags_resolution");
    jdbcTemplate.update(
        "UPDATE account_flags SET status = 'dismissed', resolved_by = ?, resolved_at = now(),"
            + " resolution_note = 'one bad week' WHERE account_flag_id = ?",
        admin,
        flag);
    // Once closed, the same condition may raise a fresh flag.
    insertFlag(driver, "driver", "low_rating");
  }

  @Test
  @DisplayName("USR-04..06: rating and manual suspension reasons; manual needs a note")
  void shouldEnforceSuspensionReasons() {
    UUID roleRow = insertRole(driver, "driver");
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'low_rating',"
            + " suspended_at = now() WHERE role_assignment_id = ?",
        roleRow);
    // Manual without a note is refused; a note on a non-manual reason is refused too.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET suspension_reason = 'manual' WHERE"
                        + " role_assignment_id = ?",
                    roleRow))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_note");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET suspension_note = 'x' WHERE role_assignment_id"
                        + " = ?",
                    roleRow))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_note");
    jdbcTemplate.update(
        "UPDATE role_assignments SET suspension_reason = 'manual', suspension_note = 'fraud'"
            + " WHERE role_assignment_id = ?",
        roleRow);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET suspension_reason = 'bored', suspension_note = NULL WHERE"
                        + " role_assignment_id = ?",
                    roleRow))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_reason");
    // An active role carries no reason.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE role_assignments SET state = 'active' WHERE role_assignment_id = ?",
                    roleRow))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_role_assignments_suspension_reason");
  }

  @Test
  @DisplayName("USR-06: whole-account suspension is manual, with a mandatory note")
  void shouldEnforceAccountSuspension() {
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE users SET state = 'suspended', suspension_reason = 'manual' WHERE"
                        + " user_id = ?",
                    rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_users_suspension_note");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE users SET suspension_reason = 'manual', suspension_note = 'x' WHERE"
                        + " user_id = ?",
                    rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_users_suspension_reason");
    jdbcTemplate.update(
        "UPDATE users SET state = 'suspended', suspension_reason = 'manual', suspension_note ="
            + " 'abuse', suspended_at = now() WHERE user_id = ?",
        rider);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT suspension_note FROM users WHERE user_id = ?", String.class, rider))
        .isEqualTo("abuse");
  }

  @Test
  @DisplayName("RBAC-04: report permissions are seeded and granted to Support and Super Admin")
  void shouldSeedReportPermissions() {
    for (String role : List.of("Support", "Super Admin")) {
      List<String> codes =
          jdbcTemplate.queryForList(
              "SELECT p.code FROM role_permissions rp JOIN roles r ON r.role_id = rp.role_id"
                  + " JOIN permissions p ON p.permission_id = rp.permission_id WHERE r.name = ?",
              String.class,
              role);
      assertThat(codes).as(role).contains("reports:view", "reports:handle");
    }
    assertThat(Permission.fromValue("reports:handle")).isEqualTo(Permission.REPORTS_HANDLE);
    assertThat(Permission.REPORTS_VIEW.getDomain()).isEqualTo("reports");
  }

  private UUID insertCompletedRide() {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, driver_user_id, vehicle_id, region_id,"
            + " service_type_id, state, pickup, destination, payment_method,"
            + " pickup_distance_mode, currency, estimate_total, estimate_distance_m,"
            + " estimate_duration_s, estimate_components, offering_at, accepted_at,"
            + " driver_arrived_at, started_at, completed_at, payment_status) VALUES"
            + " (?, ?, ?, ?, ?, ?, 'completed', ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}', now(), now(), now(), now(), now(), 'pending')",
        rideId,
        rider,
        driver,
        vehicle,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID insertRating(
      UUID rideId, UUID rater, String raterRole, UUID rated, String ratedRole, int score) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO ratings (rating_id, ride_id, rater_user_id, rater_role, rated_user_id,"
            + " rated_role, score) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        rideId,
        rater,
        raterRole,
        rated,
        ratedRole,
        score);
    return id;
  }

  private void insertSnapshot(UUID userId, String role, String avg, int count) {
    jdbcTemplate.update(
        "INSERT INTO rating_snapshots (user_id, role, avg_score, rating_count, computed_at)"
            + " VALUES (?, ?, CAST(? AS NUMERIC), ?, now())",
        userId,
        role,
        avg,
        count);
  }

  private UUID insertReport(
      UUID rideId,
      UUID reporter,
      String reporterRole,
      UUID reported,
      String reportedRole,
      String category) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO reports (report_id, ride_id, reporter_user_id, reporter_role,"
            + " reported_user_id, reported_role, category, description) VALUES"
            + " (?, ?, ?, ?, ?, ?, ?, 'what happened')",
        id,
        rideId,
        reporter,
        reporterRole,
        reported,
        reportedRole,
        category);
    return id;
  }

  private UUID insertReportFile(UUID owner) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO stored_files (stored_file_id, owner_user_id, kind, storage_key,"
            + " content_type, size_bytes) VALUES (?, ?, 'report_photo', ?, 'image/jpeg', 10)",
        id,
        owner,
        "it/" + id);
    return id;
  }

  private void insertReportPhoto(UUID reportId, int position, UUID fileId) {
    jdbcTemplate.update(
        "INSERT INTO report_photos (report_id, position, stored_file_id) VALUES (?, ?, ?)",
        reportId,
        position,
        fileId);
  }

  private UUID insertWarning(String metric) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO driver_metric_warnings (driver_metric_warning_id, driver_user_id, metric,"
            + " value_percent, threshold_percent, window_days, sample_size) VALUES"
            + " (?, ?, ?, 20.00, 15.00, 30, 25)",
        id,
        driver,
        metric);
    return id;
  }

  private UUID insertFlag(UUID userId, String role, String kind) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO account_flags (account_flag_id, user_id, role, kind, details) VALUES"
            + " (?, ?, ?, ?, '{}'::jsonb)",
        id,
        userId,
        role,
        kind);
    return id;
  }

  private UUID insertRole(UUID userId, String role) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO role_assignments (role_assignment_id, user_id, role) VALUES (?, ?, ?)",
        id,
        userId,
        role);
    return id;
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Trust Test User', now())",
        userId,
        "+9638%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
