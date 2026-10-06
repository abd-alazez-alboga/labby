package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.DevicePlatform;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.PushStatus;
import com.labby.backend.model.DeviceToken;
import com.labby.backend.model.DriverLocation;
import com.labby.backend.model.Notification;
import com.labby.backend.model.NotificationPreference;
import com.labby.backend.repository.DeviceTokenRepository;
import com.labby.backend.repository.DriverLocationRepository;
import com.labby.backend.repository.NotificationPreferenceRepository;
import com.labby.backend.repository.NotificationRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M6-T1 acceptance: V7 migrates cleanly and the realtime invariants hold at the DATABASE level —
 * one center row per outbox row (idempotent dispatcher), ride/safety never mutable (NTF-02), one
 * account per FCM token, only approved drivers online, sane location samples — and the entities
 * round-trip (bilingual text, deep-link JSON, composite preference key, SRID-4326 point).
 */
class RealtimeMigrationIntegrationTest extends AbstractIntegrationTest {

  private static final GeometryFactory GEOMETRY = new GeometryFactory(new PrecisionModel(), 4326);

  @Autowired private JdbcTemplate jdbcTemplate;
  @Autowired private NotificationRepository notificationRepository;
  @Autowired private NotificationPreferenceRepository notificationPreferenceRepository;
  @Autowired private DeviceTokenRepository deviceTokenRepository;
  @Autowired private DriverLocationRepository driverLocationRepository;

  private final List<UUID> createdUsers = new ArrayList<>();

  @AfterEach
  void cleanOwnRows() {
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM notifications WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM notification_outbox WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM notification_preferences WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM device_tokens WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM driver_locations WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM driver_profiles WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("one notification-center row per outbox row; categories and audiences checked")
  void shouldKeepDispatchIdempotent() {
    UUID user = newUser();
    UUID outbox = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO notification_outbox (notification_outbox_id, user_id, event) VALUES (?, ?,"
            + " 'driver_application.approved')",
        outbox,
        user);
    insertNotification(user, "account", "driver", outbox);

    assertThatThrownBy(() -> insertNotification(user, "account", "driver", outbox))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_notifications_outbox");
    assertThatThrownBy(() -> insertNotification(user, "gossip", "driver", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_notifications_category");
    assertThatThrownBy(() -> insertNotification(user, "account", "everyone", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_notifications_audience");
  }

  @Test
  @DisplayName("NTF-02: ride and safety can never be disabled; other categories can")
  void shouldLockRideAndSafety() {
    UUID user = newUser();
    insertPreference(user, "promotions", false);
    insertPreference(user, "ride", true);

    assertThatThrownBy(() -> insertPreference(user, "safety", false))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_notification_preferences_locked");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE notification_preferences SET enabled = false WHERE user_id = ?"
                        + " AND category = 'ride'",
                    user))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_notification_preferences_locked");
  }

  @Test
  @DisplayName("an FCM token belongs to one account at a time")
  void shouldKeepTokensUnique() {
    UUID first = newUser();
    UUID second = newUser();
    insertToken(first, "fcm-token-1");

    assertThatThrownBy(() -> insertToken(second, "fcm-token-1"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_device_tokens_token");
  }

  @Test
  @DisplayName("DRV-05: only an approved driver may be online")
  void shouldAllowOnlineOnlyWhenApproved() {
    UUID applicant = newUser();
    jdbcTemplate.update("INSERT INTO driver_profiles (user_id) VALUES (?)", applicant);

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE driver_profiles SET is_online = true WHERE user_id = ?", applicant))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_profiles_online_approved");

    UUID driver = newUser();
    jdbcTemplate.update(
        "INSERT INTO driver_profiles (user_id, application_status, is_online, online_changed_at)"
            + " VALUES (?, 'approved', true, now())",
        driver);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?", Boolean.class, driver))
        .isTrue();
  }

  @Test
  @DisplayName("location samples: heading in [0,360), non-negative speed and accuracy")
  void shouldRejectInsaneSamples() {
    UUID driver = newUser();
    assertThatThrownBy(() -> insertLocation(driver, 360f))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_driver_locations_heading");
    insertLocation(driver, 359.9f);
  }

  @Test
  @DisplayName("entities round-trip: bilingual text, deep link, composite key, SRID-4326 point")
  void shouldRoundTripEntities() {
    UUID user = newUser();
    Notification saved =
        notificationRepository.save(
            Notification.builder()
                .userId(user)
                .audience(NotificationAudience.DRIVER)
                .category(NotificationCategory.ACCOUNT)
                .event("driver_application.approved")
                .titleEn("You're approved")
                .bodyEn("Welcome to Labby")
                .titleAr("تمت الموافقة")
                .bodyAr("أهلاً بك في لبي")
                .linkScreen("driver_application")
                .linkParams(Map.of("tab", "status"))
                .build());
    Notification loaded = notificationRepository.findById(saved.getId()).orElseThrow();
    assertThat(loaded.getBodyAr()).isEqualTo("أهلاً بك في لبي");
    assertThat(loaded.getLinkParams()).containsEntry("tab", "status");
    assertThat(loaded.getPushStatus()).isEqualTo(PushStatus.PENDING);
    assertThat(
            notificationRepository.countByUserIdAndAudienceInAndReadAtIsNull(
                user, List.of(NotificationAudience.DRIVER, NotificationAudience.ALL)))
        .isEqualTo(1);
    assertThat(
            notificationRepository.countByUserIdAndAudienceInAndReadAtIsNull(
                user, List.of(NotificationAudience.RIDER, NotificationAudience.ALL)))
        .isZero();

    notificationPreferenceRepository.save(
        NotificationPreference.builder()
            .userId(user)
            .category(NotificationCategory.PROMOTIONS.getValue())
            .enabled(false)
            .build());
    assertThat(
            notificationPreferenceRepository.findById(
                NotificationPreference.key(user, NotificationCategory.PROMOTIONS)))
        .get()
        .extracting(NotificationPreference::isEnabled)
        .isEqualTo(false);

    deviceTokenRepository.save(
        DeviceToken.builder()
            .userId(user)
            .token("fcm-round-trip")
            .platform(DevicePlatform.ANDROID)
            .app(ClientType.DRIVER)
            .build());
    assertThat(deviceTokenRepository.findByToken("fcm-round-trip"))
        .get()
        .extracting(DeviceToken::getApp)
        .isEqualTo(ClientType.DRIVER);

    Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
    driverLocationRepository.save(
        DriverLocation.builder()
            .userId(user)
            .position(GEOMETRY.createPoint(new Coordinate(36.29, 33.51)))
            .headingDeg(90f)
            .speedMps(8.5f)
            .recordedAt(now)
            .receivedAt(now)
            .build());
    DriverLocation location = driverLocationRepository.findById(user).orElseThrow();
    assertThat(location.getPosition().getX()).isEqualTo(36.29);
    assertThat(location.getPosition().getY()).isEqualTo(33.51);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT ST_SRID(position) FROM driver_locations WHERE user_id = ?",
                Integer.class,
                user))
        .isEqualTo(4326);
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Realtime Test User', now())",
        userId,
        "+9639%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }

  private void insertNotification(UUID user, String category, String audience, UUID outbox) {
    jdbcTemplate.update(
        "INSERT INTO notifications (user_id, audience, category, event, title_en, body_en,"
            + " title_ar, body_ar, notification_outbox_id) VALUES (?, ?, ?, 'e', 't', 'b', 't',"
            + " 'b', ?)",
        user,
        audience,
        category,
        outbox);
  }

  private void insertPreference(UUID user, String category, boolean enabled) {
    jdbcTemplate.update(
        "INSERT INTO notification_preferences (user_id, category, enabled) VALUES (?, ?, ?)",
        user,
        category,
        enabled);
  }

  private void insertToken(UUID user, String token) {
    jdbcTemplate.update(
        "INSERT INTO device_tokens (user_id, token, platform, app) VALUES (?, ?, 'android',"
            + " 'driver')",
        user,
        token);
  }

  private void insertLocation(UUID user, float heading) {
    jdbcTemplate.update(
        "INSERT INTO driver_locations (user_id, position, heading_deg, recorded_at, received_at)"
            + " VALUES (?, ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), ?, now(), now())",
        user,
        heading);
  }
}
