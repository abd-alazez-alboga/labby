package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
 * M10-T1 acceptance: V15 migrates cleanly and the comms invariants hold at the DATABASE level — one
 * chat thread per ride with a sane window (CHAT-01), message shape and the client_msg_id dedup key
 * (the T2 reconnection AC), a localized seeded quick-reply catalog (CHAT-02), share links storing
 * only a unique token hash with one link per user per ride (SHARE-02 + owner ruling), and SOS
 * events that are permanent: DELETE always blocked, core facts immutable, only the handling fields
 * writable (SAFE-02).
 */
class CommsMigrationIntegrationTest extends AbstractIntegrationTest {

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
        "Comms IT " + regionId);
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
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'DM-M10', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
  }

  @AfterEach
  void cleanOwnRows() {
    // sos_events are permanent by trigger; TRUNCATE bypasses row-level triggers (same approach
    // as the money ledgers). Threads and messages reference each other via the read markers.
    jdbcTemplate.execute("TRUNCATE sos_events");
    jdbcTemplate.execute("TRUNCATE chat_messages, chat_threads");
    jdbcTemplate.update(
        "DELETE FROM trip_share_links WHERE ride_id IN (SELECT ride_id FROM"
            + " rides WHERE region_id = ?)",
        regionId);
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("CHAT-01: one thread per ride; a window closing before it opened is refused")
  void shouldEnforceThreadShape() {
    UUID ride = insertAcceptedRide();
    insertThread(ride);
    assertThatThrownBy(() -> insertThread(ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("chat_threads_ride_id_key");
    UUID other = insertAcceptedRide();
    UUID thread = UUID.randomUUID();
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO chat_threads (chat_thread_id, ride_id, opened_at, closed_at)"
                        + " VALUES (?, ?, now(), now() - interval '1 hour')",
                    thread,
                    other))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_chat_threads_window");
  }

  @Test
  @DisplayName("messages are shaped per kind and deduplicated by (thread, sender, client id)")
  void shouldEnforceMessageShapeAndDedup() {
    UUID thread = insertThread(insertAcceptedRide());
    // A text message without a body, and a quick reply carrying a body, are both refused.
    assertThatThrownBy(() -> insertMessage(thread, rider, "text", null, null, UUID.randomUUID()))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_chat_messages_shape");
    assertThatThrownBy(
            () ->
                insertMessage(
                    thread, rider, "quick_reply", "hi", "rider_coming", UUID.randomUUID()))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_chat_messages_shape");
    // An unknown quick-reply code is refused (catalog FK).
    assertThatThrownBy(
            () -> insertMessage(thread, rider, "quick_reply", null, "nope", UUID.randomUUID()))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("chat_messages_quick_reply_code_fkey");
    // The dedup key: the same sender resending the same client id is refused; the counterpart
    // reusing the same client id is NOT (dedup is per sender).
    UUID clientMsgId = UUID.randomUUID();
    insertMessage(thread, rider, "text", "where are you?", null, clientMsgId);
    assertThatThrownBy(() -> insertMessage(thread, rider, "text", "resend", null, clientMsgId))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_chat_messages_dedup");
    insertMessage(thread, driver, "quick_reply", null, "driver_on_my_way", clientMsgId);
    // Read markers point at real messages of the thread.
    UUID marker =
        jdbcTemplate.queryForObject(
            "SELECT chat_message_id FROM chat_messages WHERE thread_id = ? AND sender_user_id = ?",
            UUID.class,
            thread,
            rider);
    jdbcTemplate.update(
        "UPDATE chat_threads SET driver_last_read_message_id = ? WHERE chat_thread_id = ?",
        marker,
        thread);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE chat_threads SET rider_last_read_message_id = ? WHERE chat_thread_id"
                        + " = ?",
                    UUID.randomUUID(),
                    thread))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  @DisplayName("CHAT-02: the quick-reply catalog is seeded, localized and audience-typed")
  void shouldSeedQuickReplies() {
    Integer total =
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM chat_quick_replies", Integer.class);
    assertThat(total).isGreaterThanOrEqualTo(6);
    Integer missingText =
        jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM chat_quick_replies WHERE length(trim(text_en)) = 0 OR"
                + " length(trim(text_ar)) = 0",
            Integer.class);
    assertThat(missingText).isZero();
    // Every audience is represented, and only valid audiences exist (DB CHECK).
    List<String> audiences =
        jdbcTemplate.queryForList(
            "SELECT DISTINCT audience FROM chat_quick_replies ORDER BY audience", String.class);
    assertThat(audiences).containsExactly("both", "driver", "rider");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO chat_quick_replies (code, audience, text_en, text_ar,"
                        + " sort_order) VALUES ('x', 'admin', 'x', 'x', 1)"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_chat_quick_replies_audience");
  }

  @Test
  @DisplayName("SHARE-02: token hashes are unique; one link per user per ride")
  void shouldEnforceShareLinkShape() {
    UUID ride = insertAcceptedRide();
    String hash = "a".repeat(64);
    insertShareLink(ride, rider, hash);
    // The same token hash can never exist twice (unguessable-token invariant).
    UUID otherRide = insertAcceptedRide();
    assertThatThrownBy(() -> insertShareLink(otherRide, rider, hash))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_trip_share_links_token");
    // One link per user per ride (owner ruling) — the driver still gets their own.
    assertThatThrownBy(() -> insertShareLink(ride, rider, "b".repeat(64)))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_trip_share_links_ride_user");
    insertShareLink(ride, driver, "c".repeat(64));
  }

  @Test
  @DisplayName("SAFE-02: SOS events are permanent — no DELETE, immutable facts, writable handling")
  void shouldEnforceSosPermanence() {
    UUID ride = insertAcceptedRide();
    UUID sos = insertSos(ride, rider, "rider");
    assertThatThrownBy(
            () -> jdbcTemplate.update("DELETE FROM sos_events WHERE sos_event_id = ?", sos))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("permanent");
    for (String mutation :
        List.of(
            "ride_id = gen_random_uuid()",
            "triggered_by_role = 'driver'",
            "location = ST_SetSRID(ST_MakePoint(0, 0), 4326)",
            "triggered_at = now()",
            "created_at = now()")) {
      assertThatThrownBy(
              () ->
                  jdbcTemplate.update(
                      "UPDATE sos_events SET " + mutation + " WHERE sos_event_id = ?", sos))
          .as(mutation)
          .isInstanceOf(DataAccessException.class)
          .hasMessageContaining("immutable");
    }
    // Acknowledging needs both fields together (CHECK), then succeeds with a note.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE sos_events SET acknowledged_by = ? WHERE sos_event_id = ?", admin, sos))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("ck_sos_events_ack");
    jdbcTemplate.update(
        "UPDATE sos_events SET acknowledged_by = ?, acknowledged_at = now(), note = 'stood down'"
            + " WHERE sos_event_id = ?",
        admin,
        sos);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT note FROM sos_events WHERE sos_event_id = ?", String.class, sos))
        .isEqualTo("stood down");
    // Repeat SOS taps on the same ride are repeat events, never deduplicated.
    insertSos(ride, driver, "driver");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM sos_events WHERE ride_id = ?", Integer.class, ride))
        .isEqualTo(2);
  }

  private UUID insertAcceptedRide() {
    UUID rideId = UUID.randomUUID();
    // One ACTIVE ride per rider (uq_rides_rider_active), so each accepted ride gets a fresh
    // rider; party membership of senders/creators is service-level, not schema-level.
    UUID rideRider = newUser();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, driver_user_id, vehicle_id, region_id,"
            + " service_type_id, state, pickup, destination, payment_method,"
            + " pickup_distance_mode, currency, estimate_total, estimate_distance_m,"
            + " estimate_duration_s, estimate_components, offering_at, accepted_at) VALUES"
            + " (?, ?, ?, ?, ?, ?, 'accepted', ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}', now(), now())",
        rideId,
        rideRider,
        driver,
        vehicle,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID insertThread(UUID rideId) {
    UUID threadId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO chat_threads (chat_thread_id, ride_id) VALUES (?, ?)", threadId, rideId);
    return threadId;
  }

  private void insertMessage(
      UUID threadId, UUID sender, String kind, String body, String code, UUID clientMsgId) {
    jdbcTemplate.update(
        "INSERT INTO chat_messages (thread_id, sender_user_id, sender_role, kind, body,"
            + " quick_reply_code, client_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        threadId,
        sender,
        sender.equals(rider) ? "rider" : "driver",
        kind,
        body,
        code,
        clientMsgId);
  }

  private void insertShareLink(UUID rideId, UUID creator, String tokenHash) {
    jdbcTemplate.update(
        "INSERT INTO trip_share_links (ride_id, created_by_user_id, token_hash) VALUES (?, ?, ?)",
        rideId,
        creator,
        tokenHash);
  }

  private UUID insertSos(UUID rideId, UUID by, String role) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO sos_events (sos_event_id, ride_id, triggered_by_user_id, triggered_by_role,"
            + " location, triggered_at) VALUES (?, ?, ?, ?,"
            + " ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), now())",
        id,
        rideId,
        by,
        role);
    return id;
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Comms Test User', now())",
        userId,
        "+9637%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
