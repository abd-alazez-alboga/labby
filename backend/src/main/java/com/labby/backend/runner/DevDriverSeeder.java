package com.labby.backend.runner;

import com.labby.backend.service.OperatingCalendar;
import com.labby.backend.service.StorageProvider;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import javax.imageio.ImageIO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dev-profile approved demo drivers per backend/docs/SEEDING.md (M5-T5): fully onboarded drivers
 * (approved application + history, approved documents, one active vehicle with Damascus service
 * types, placeholder files in private storage) so later milestones (dispatch, rides, money) have
 * drivers to work with. The launch market is Syria — Syrian names, Damascus plates, Damascus
 * service types. Also backfills the M2 fixture {@code +963900000002}, whose driver role predates
 * onboarding. Idempotent per driver: skipped once that account has a driver profile, so admin edits
 * survive restarts. Runs after {@link DevDataSeeder} and {@link DevRegionSeeder}; skipped entirely
 * while the Damascus region is missing. One demo insurance expires inside the 30-day horizon so the
 * expiry dashboard (UC-A-12) has something to show.
 */
@Slf4j
@Component
@Profile("dev")
@Order(Ordered.LOWEST_PRECEDENCE)
@RequiredArgsConstructor
public class DevDriverSeeder implements ApplicationRunner {

  private record DemoDriver(
      String phone,
      String name,
      String make,
      String model,
      int year,
      String color,
      String plate,
      int seats,
      List<String> serviceTypes,
      int insuranceDaysLeft) {}

  private static final String SEED_PASSWORD = "Password1!";
  private static final String REGION_NAME = "Damascus";
  private static final String ADMIN_PHONE = "+963900000004";
  private static final int VALID_DAYS = 365;

  private static final List<DemoDriver> DEMO_DRIVERS =
      List.of(
          new DemoDriver(
              "+963900000002",
              "Dev Driver",
              "Kia",
              "Rio",
              2019,
              "White",
              "دمشق501234",
              4,
              List.of("Economy"),
              VALID_DAYS),
          new DemoDriver(
              "+963900000005",
              "سامر الخطيب",
              "Hyundai",
              "Accent",
              2018,
              "Silver",
              "دمشق502345",
              4,
              List.of("Economy", "Comfort"),
              VALID_DAYS),
          new DemoDriver(
              "+963900000006",
              "ليلى حداد",
              "Toyota",
              "Corolla",
              2021,
              "White",
              "دمشق503456",
              4,
              List.of("Comfort"),
              20),
          new DemoDriver(
              "+963900000007",
              "عمر النوري",
              "Kia",
              "Carnival",
              2017,
              "Grey",
              "دمشق504567",
              7,
              List.of("Economy", "Family"),
              VALID_DAYS));

  private final JdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;
  private final StorageProvider storageProvider;
  private final OperatingCalendar operatingCalendar;

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    List<UUID> regionIds =
        jdbcTemplate.queryForList(
            "SELECT region_id FROM regions WHERE name = ?", UUID.class, REGION_NAME);
    if (regionIds.isEmpty()) {
      log.warn("Skipping demo drivers: region {} is missing", REGION_NAME);
      return;
    }
    UUID regionId = regionIds.get(0);
    UUID adminId = userIdByPhone(ADMIN_PHONE);
    for (DemoDriver driver : DEMO_DRIVERS) {
      UUID userId = userIdByPhone(driver.phone());
      if (userId != null && hasDriverProfile(userId)) {
        continue;
      }
      if (userId == null) {
        userId = insertAccount(driver);
      }
      seedDriver(userId, adminId == null ? userId : adminId, regionId, driver);
      log.info("Seeded demo driver {} ({} {})", driver.phone(), driver.make(), driver.model());
    }
  }

  private UUID insertAccount(DemoDriver driver) {
    UUID userId = UUID.randomUUID();
    String photoKey = storageProvider.store("photos/" + userId + ".png", placeholder(0x5B3A8C));
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, photo_path, language, state,"
            + " terms_accepted_at) VALUES (?, ?, ?, ?, ?, 'ar', 'active', now())",
        userId,
        driver.phone(),
        passwordEncoder.encode(SEED_PASSWORD),
        driver.name(),
        photoKey);
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'rider', 'active')",
        userId);
    return userId;
  }

  private void seedDriver(UUID userId, UUID reviewerId, UUID regionId, DemoDriver driver) {
    Instant now = operatingCalendar.now();
    Timestamp submittedAt = Timestamp.from(now.minus(30, ChronoUnit.DAYS));
    Timestamp reviewStartedAt = Timestamp.from(now.minus(29, ChronoUnit.DAYS));
    Timestamp decidedAt = Timestamp.from(now.minus(28, ChronoUnit.DAYS));
    LocalDate today = operatingCalendar.today();

    UUID profileId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO driver_profiles (driver_profile_id, user_id, application_status,"
            + " submitted_at, decided_at, decided_by, personal_review_status)"
            + " VALUES (?, ?, 'approved', ?, ?, ?, 'approved')",
        profileId,
        userId,
        submittedAt,
        decidedAt,
        reviewerId);
    insertEvent(profileId, null, "submitted", userId, submittedAt);
    insertEvent(profileId, "submitted", "under_review", reviewerId, reviewStartedAt);
    insertEvent(profileId, "under_review", "approved", reviewerId, decidedAt);

    UUID vehicleId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, reviewed_by, reviewed_at, is_active)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, true)",
        vehicleId,
        userId,
        driver.make(),
        driver.model(),
        driver.year(),
        driver.color(),
        driver.plate(),
        driver.seats(),
        reviewerId,
        decidedAt);
    int position = 1;
    for (int colour : new int[] {0x8C8C8C, 0x3A6B8C}) {
      jdbcTemplate.update(
          "INSERT INTO vehicle_photos (vehicle_id, position, stored_file_id) VALUES (?, ?, ?)",
          vehicleId,
          position++,
          storeFile(userId, "vehicle_photo", colour));
    }
    jdbcTemplate.update(
        "INSERT INTO vehicle_service_types (vehicle_id, service_type_id)"
            + " SELECT ?, service_type_id FROM service_types"
            + " WHERE region_id = ? AND name_en = ANY (?) AND enabled",
        vehicleId,
        regionId,
        driver.serviceTypes().toArray(String[]::new));

    LocalDate validUntil = today.plusDays(VALID_DAYS);
    insertDocument(userId, null, "government_id", validUntil, reviewerId, decidedAt, 0x2E7D32);
    insertDocument(userId, null, "drivers_license", validUntil, reviewerId, decidedAt, 0x1565C0);
    insertDocument(
        userId, vehicleId, "vehicle_registration", validUntil, reviewerId, decidedAt, 0xEF6C00);
    insertDocument(
        userId,
        vehicleId,
        "insurance",
        today.plusDays(driver.insuranceDaysLeft()),
        reviewerId,
        decidedAt,
        0xAD1457);

    Integer driverRoles =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM role_assignments WHERE user_id = ? AND role = 'driver'",
            Integer.class,
            userId);
    if (driverRoles == null || driverRoles == 0) {
      jdbcTemplate.update(
          "INSERT INTO role_assignments (user_id, role, state) VALUES (?, 'driver', 'active')",
          userId);
    }
  }

  private void insertEvent(
      UUID profileId, String from, String to, UUID actorId, Timestamp createdAt) {
    jdbcTemplate.update(
        "INSERT INTO driver_application_events (driver_profile_id, from_status, to_status,"
            + " actor_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        profileId,
        from,
        to,
        actorId,
        createdAt);
  }

  private void insertDocument(
      UUID userId,
      UUID vehicleId,
      String type,
      LocalDate expiresOn,
      UUID reviewerId,
      Timestamp reviewedAt,
      int colour) {
    jdbcTemplate.update(
        "INSERT INTO documents (driver_user_id, vehicle_id, type, number, expires_on,"
            + " stored_file_id, review_status, reviewed_by, reviewed_at)"
            + " VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)",
        userId,
        vehicleId,
        type,
        "DEMO-" + type.toUpperCase().replace('_', '-') + "-" + userId.toString().substring(0, 6),
        expiresOn,
        storeFile(userId, "document", colour),
        reviewerId,
        reviewedAt);
  }

  private UUID storeFile(UUID ownerId, String kind, int colour) {
    UUID fileId = UUID.randomUUID();
    byte[] content = placeholder(colour);
    String key = storageProvider.store("driver-files/" + fileId + ".png", content);
    jdbcTemplate.update(
        "INSERT INTO stored_files (stored_file_id, owner_user_id, kind, storage_key, content_type,"
            + " size_bytes) VALUES (?, ?, ?, ?, 'image/png', ?)",
        fileId,
        ownerId,
        kind,
        key,
        content.length);
    return fileId;
  }

  private UUID userIdByPhone(String phone) {
    List<UUID> ids =
        jdbcTemplate.queryForList("SELECT user_id FROM users WHERE phone = ?", UUID.class, phone);
    return ids.isEmpty() ? null : ids.get(0);
  }

  private boolean hasDriverProfile(UUID userId) {
    Integer count =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM driver_profiles WHERE user_id = ?", Integer.class, userId);
    return count != null && count > 0;
  }

  /** A plain coloured 320×200 PNG standing in for a scanned document or photo. */
  private static byte[] placeholder(int rgb) {
    BufferedImage image = new BufferedImage(320, 200, BufferedImage.TYPE_INT_RGB);
    Graphics2D graphics = image.createGraphics();
    graphics.setColor(new Color(rgb));
    graphics.fillRect(0, 0, 320, 200);
    graphics.setColor(Color.WHITE);
    graphics.fillRect(20, 20, 280, 24);
    graphics.fillRect(20, 60, 180, 16);
    graphics.fillRect(20, 90, 220, 16);
    graphics.dispose();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      ImageIO.write(image, "png", out);
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to render placeholder image", ex);
    }
    return out.toByteArray();
  }
}
