package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.NotificationService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * M6-T2 acceptance (NTF-01..03, UC-S-11/12/25, NFR-A3): the dispatcher turns queued outbox events —
 * including M5 rows queued before it existed — into exactly one bilingual center row each, pushes
 * per category preferences in the user's language, never loses the center row on a push failure,
 * prunes dead tokens; the center API pages newest first per client audience and only ever exposes
 * the caller's own notifications. {@link PushSender} is mocked at the boundary.
 */
class NotificationsIntegrationTest extends AbstractOnboardingIntegrationTest {

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private NotificationService notificationService;

  @BeforeEach
  void pushSucceeds() {
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of()));
  }

  private ResponseEntity<JsonNode> put(String url, Object body, String token) {
    HttpHeaders headers = bearer(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return restTemplate.exchange(
        url, HttpMethod.PUT, new HttpEntity<>(body, headers), JsonNode.class);
  }

  private ResponseEntity<JsonNode> delete(String url, String token) {
    return restTemplate.exchange(
        url, HttpMethod.DELETE, new HttpEntity<>(bearer(token)), JsonNode.class);
  }

  private void registerDevice(Account account, String token, String app) {
    ok(
        put(
            "/api/v1/devices",
            Map.of("token", token, "platform", "android", "app", app),
            account.token()),
        HttpStatus.NO_CONTENT);
  }

  private void setLanguage(Account account, String language) {
    ok(
        put(
            "/api/v1/users/me",
            Map.of("name", "Driver " + account.phone(), "language", language),
            account.token()),
        HttpStatus.OK);
  }

  private JsonNode center(Account account, String query) {
    return ok(get("/api/v1/notifications?" + query, account.token()), HttpStatus.OK);
  }

  private String pushStatus(UUID userId, String event) {
    return jdbcTemplate.queryForObject(
        "SELECT push_status FROM notifications WHERE user_id = ? AND event = ?",
        String.class,
        userId,
        event);
  }

  private int count(String sql, Object... args) {
    return jdbcTemplate.queryForObject(sql, Integer.class, args);
  }

  @Test
  @DisplayName("M5 rows queued before M6 flow through once: center + push, outbox delivered")
  void shouldBackfillPreExistingOutboxRowsExactlyOnce() {
    String admin = registerSuperAdmin("+963939000001");
    UUID economy = serviceType("Economy", true, true);
    Account driver = approvedDriver("+963939000011", "NTF1", economy, admin);
    registerDevice(driver, "fcm-driver-1", "driver");
    assertThat(outboxEvents(driver.userId()))
        .containsExactly(
            "driver_application.submitted",
            "driver_application.under_review",
            "driver_application.approved");
    assertThat(center(driver, "app=driver").get("items")).isEmpty();

    int delivered = notificationDispatchService.dispatchPending();

    assertThat(delivered).isGreaterThanOrEqualTo(3);
    JsonNode page = center(driver, "app=driver");
    assertThat(page.get("items")).hasSize(3);
    assertThat(page.get("unread").asInt()).isEqualTo(3);
    JsonNode newest = page.get("items").get(0);
    assertThat(newest.get("event").asText()).isEqualTo("driver_application.approved");
    assertThat(newest.get("category").asText()).isEqualTo("account");
    assertThat(newest.get("title").asText()).isEqualTo("You're approved!");
    assertThat(newest.get("link").get("screen").asText()).isEqualTo("driver_application");
    assertThat(newest.get("read").asBoolean()).isFalse();
    assertThat(page.get("items").get(2).get("event").asText())
        .isEqualTo("driver_application.submitted");
    assertThat(
            count(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ?"
                    + " AND delivered_at IS NULL",
                driver.userId()))
        .isZero();
    assertThat(pushStatus(driver.userId(), "driver_application.approved")).isEqualTo("sent");

    // Idempotent: a second pass delivers nothing new and pushes nothing again.
    Mockito.clearInvocations(pushSender);
    assertThat(notificationDispatchService.dispatchPending()).isZero();
    assertThat(count("SELECT count(*) FROM notifications WHERE user_id = ?", driver.userId()))
        .isEqualTo(3);
    verify(pushSender, never()).send(anyList(), any());
  }

  @Test
  @DisplayName("EN + AR rendered; the user's language picks the push and center language")
  void shouldLocalizePushAndCenterByUserLanguage() {
    Account driver = registerWithoutPhoto("+963939000021", "Layla");
    registerDevice(driver, "fcm-ar-1", "driver");
    setLanguage(driver, "ar");
    notificationService.queue(
        driver.userId(),
        NotificationEvent.DOCUMENT_EXPIRY_REMINDER,
        Map.of("documentType", "insurance", "expiresOn", "2026-11-05", "daysLeft", 30));

    notificationDispatchService.dispatchPending();

    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushSender).send(Mockito.eq(List.of("fcm-ar-1")), message.capture());
    assertThat(message.getValue().title()).isEqualTo("وثيقة تقترب من انتهاء صلاحيتها");
    assertThat(message.getValue().body()).contains("التأمين", "2026-11-05", "30 يوماً");
    assertThat(message.getValue().data())
        .containsEntry("event", "document.expiry_reminder")
        .containsEntry("category", "account")
        .containsEntry("screen", "driver_documents")
        .containsEntry("params", "{\"documentType\":\"insurance\"}")
        .containsKey("notificationId");
    Map<String, Object> row =
        jdbcTemplate.queryForMap(
            "SELECT title_en, body_en, title_ar, body_ar FROM notifications WHERE user_id = ?",
            driver.userId());
    assertThat(row.get("title_en")).isEqualTo("Document expiring soon");
    assertThat((String) row.get("body_en")).contains("Your insurance expires on 2026-11-05");
    assertThat(row.get("title_ar")).isEqualTo("وثيقة تقترب من انتهاء صلاحيتها");

    JsonNode arabic = center(driver, "app=driver").get("items").get(0);
    assertThat(arabic.get("title").asText()).isEqualTo("وثيقة تقترب من انتهاء صلاحيتها");
    assertThat(arabic.get("link").get("params").get("documentType").asText())
        .isEqualTo("insurance");
    // A language switch re-renders the stored center instantly.
    setLanguage(driver, "en");
    assertThat(center(driver, "app=driver").get("items").get(0).get("title").asText())
        .isEqualTo("Document expiring soon");
  }

  @Test
  @DisplayName("muted category: no push, center still records (UC-S-25 A1); locked can't mute")
  void shouldHonourPreferencesAndLockCriticalCategories() {
    Account driver = registerWithoutPhoto("+963939000031", "Omar");
    registerDevice(driver, "fcm-muted-1", "driver");

    JsonNode defaults = ok(get("/api/v1/notifications/preferences", driver.token()), HttpStatus.OK);
    assertThat(defaults).hasSize(6);
    for (JsonNode preference : defaults) {
      assertThat(preference.get("enabled").asBoolean()).isTrue();
      String category = preference.get("category").asText();
      assertThat(preference.get("locked").asBoolean())
          .isEqualTo(category.equals("ride") || category.equals("safety"));
    }

    assertThat(
            put(
                    "/api/v1/notifications/preferences",
                    List.of(Map.of("category", "ride", "enabled", false)),
                    driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            put(
                    "/api/v1/notifications/preferences",
                    List.of(Map.of("category", "safety", "enabled", false)),
                    driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            put(
                    "/api/v1/notifications/preferences",
                    List.of(Map.of("category", "nonsense", "enabled", false)),
                    driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    JsonNode updated =
        ok(
            put(
                "/api/v1/notifications/preferences",
                List.of(
                    Map.of("category", "account", "enabled", false),
                    Map.of("category", "ride", "enabled", true)),
                driver.token()),
            HttpStatus.OK);
    assertThat(updated).hasSize(6);
    for (JsonNode preference : updated) {
      assertThat(preference.get("enabled").asBoolean())
          .isEqualTo(!preference.get("category").asText().equals("account"));
    }

    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);
    notificationDispatchService.dispatchPending();

    verify(pushSender, never()).send(anyList(), any());
    assertThat(pushStatus(driver.userId(), "driver.reinstated")).isEqualTo("muted");
    assertThat(center(driver, "app=driver").get("items")).hasSize(1);

    // Re-enabling resumes pushes.
    ok(
        put(
            "/api/v1/notifications/preferences",
            List.of(Map.of("category", "account", "enabled", true)),
            driver.token()),
        HttpStatus.OK);
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_APPLICATION_APPROVED);
    notificationDispatchService.dispatchPending();
    assertThat(pushStatus(driver.userId(), "driver_application.approved")).isEqualTo("sent");
  }

  @Test
  @DisplayName("a throwing push sender leaves the center row intact (NFR-A3)")
  void shouldKeepCenterRowWhenPushFails() {
    Account driver = registerWithoutPhoto("+963939000041", "Rami");
    registerDevice(driver, "fcm-fail-1", "driver");
    when(pushSender.send(anyList(), any())).thenThrow(new IllegalStateException("FCM down"));
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);

    notificationDispatchService.dispatchPending();

    assertThat(pushStatus(driver.userId(), "driver.reinstated")).isEqualTo("failed");
    assertThat(center(driver, "app=driver").get("items")).hasSize(1);
    assertThat(
            count(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ?"
                    + " AND delivered_at IS NOT NULL",
                driver.userId()))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("no device → no_device; dead tokens reported by FCM are pruned")
  void shouldRecordNoDeviceAndPruneDeadTokens() {
    Account driver = registerWithoutPhoto("+963939000051", "Sami");
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);
    notificationDispatchService.dispatchPending();
    assertThat(pushStatus(driver.userId(), "driver.reinstated")).isEqualTo("no_device");

    registerDevice(driver, "fcm-live", "driver");
    registerDevice(driver, "fcm-dead", "driver");
    // A rider-app token never receives a driver-audience push.
    registerDevice(driver, "fcm-rider-app", "rider");
    when(pushSender.send(anyList(), any())).thenReturn(new PushResult(1, Set.of("fcm-dead")));
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_APPLICATION_APPROVED);
    notificationDispatchService.dispatchPending();

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<String>> tokens = ArgumentCaptor.forClass(List.class);
    verify(pushSender).send(tokens.capture(), any());
    assertThat(tokens.getValue()).containsExactlyInAnyOrder("fcm-live", "fcm-dead");
    assertThat(pushStatus(driver.userId(), "driver_application.approved")).isEqualTo("sent");
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT token FROM device_tokens WHERE user_id = ? ORDER BY token",
                String.class,
                driver.userId()))
        .containsExactly("fcm-live", "fcm-rider-app");
  }

  @Test
  @DisplayName("center pages newest first with a stable cursor and a category filter")
  void shouldPaginateNewestFirst() {
    Account driver = registerWithoutPhoto("+963939000061", "Hadi");
    List<NotificationEvent> events =
        List.of(
            NotificationEvent.DRIVER_APPLICATION_SUBMITTED,
            NotificationEvent.DRIVER_APPLICATION_UNDER_REVIEW,
            NotificationEvent.DRIVER_APPLICATION_NEEDS_CHANGES,
            NotificationEvent.DRIVER_APPLICATION_APPROVED,
            NotificationEvent.VEHICLE_SWITCH_SUBMITTED);
    for (NotificationEvent event : events) {
      notificationService.queue(driver.userId(), event);
    }
    notificationDispatchService.dispatchPending();

    List<String> seen = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    String cursor = null;
    int pages = 0;
    do {
      JsonNode page =
          center(driver, "app=driver&size=2" + (cursor == null ? "" : "&before=" + cursor));
      pages++;
      assertThat(page.get("unread").asInt()).isEqualTo(5);
      for (JsonNode item : page.get("items")) {
        seen.add(item.get("event").asText());
        ids.add(item.get("id").asText());
      }
      cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asText();
    } while (cursor != null);

    assertThat(pages).isEqualTo(3);
    assertThat(ids).hasSize(5);
    assertThat(seen)
        .containsExactly(
            "vehicle_switch.submitted",
            "driver_application.approved",
            "driver_application.needs_changes",
            "driver_application.under_review",
            "driver_application.submitted");

    assertThat(center(driver, "app=driver&category=account").get("items")).hasSize(5);
    assertThat(center(driver, "app=driver&category=ride").get("items")).isEmpty();
    assertThat(get("/api/v1/notifications?app=driver&before=%%%", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            get("/api/v1/notifications?app=driver&before=bm9wZQ", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/notifications", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/notifications?app=web", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/notifications?app=driver&category=x", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/notifications?app=driver", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  @DisplayName("a driver notification is not in the rider center; read state per client")
  void shouldIsolateAudiences() {
    Account driver = registerWithoutPhoto("+963939000071", "Nour");
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_REINSTATED);
    notificationService.queue(driver.userId(), NotificationEvent.DRIVER_APPLICATION_APPROVED);
    notificationDispatchService.dispatchPending();

    assertThat(center(driver, "app=rider").get("items")).isEmpty();
    assertThat(center(driver, "app=rider").get("unread").asInt()).isZero();
    assertThat(center(driver, "app=admin").get("items")).isEmpty();
    assertThat(
            ok(get("/api/v1/notifications/unread-count?app=driver", driver.token()), HttpStatus.OK)
                .get("unread")
                .asInt())
        .isEqualTo(2);

    // read-all on the rider center touches nothing of the driver center.
    ok(
        post("/api/v1/notifications/read-all?app=rider", null, driver.token()),
        HttpStatus.NO_CONTENT);
    assertThat(center(driver, "app=driver").get("unread").asInt()).isEqualTo(2);

    String firstId = center(driver, "app=driver").get("items").get(0).get("id").asText();
    ok(
        post("/api/v1/notifications/" + firstId + "/read", null, driver.token()),
        HttpStatus.NO_CONTENT);
    ok(
        post("/api/v1/notifications/" + firstId + "/read", null, driver.token()),
        HttpStatus.NO_CONTENT);
    JsonNode afterOne = center(driver, "app=driver");
    assertThat(afterOne.get("unread").asInt()).isEqualTo(1);
    assertThat(afterOne.get("items").get(0).get("read").asBoolean()).isTrue();

    ok(
        post("/api/v1/notifications/read-all?app=driver", null, driver.token()),
        HttpStatus.NO_CONTENT);
    assertThat(center(driver, "app=driver").get("unread").asInt()).isZero();
  }

  @Test
  @DisplayName("another user's notification can't be read or marked: 404")
  void shouldHideOtherUsersNotifications() {
    Account owner = registerWithoutPhoto("+963939000081", "Owner");
    Account stranger = registerWithoutPhoto("+963939000082", "Stranger");
    notificationService.queue(owner.userId(), NotificationEvent.DRIVER_REINSTATED);
    notificationDispatchService.dispatchPending();
    String id = center(owner, "app=driver").get("items").get(0).get("id").asText();

    assertThat(
            post("/api/v1/notifications/" + id + "/read", null, stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            post("/api/v1/notifications/" + UUID.randomUUID() + "/read", null, owner.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(post("/api/v1/notifications/not-a-uuid/read", null, owner.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(center(stranger, "app=driver").get("items")).isEmpty();
    ok(
        post("/api/v1/notifications/read-all?app=driver", null, stranger.token()),
        HttpStatus.NO_CONTENT);
    assertThat(center(owner, "app=driver").get("unread").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("device tokens: register, re-assign to the new caller, foreign delete is a no-op")
  void shouldRegisterAndReassignDeviceTokens() {
    Account first = registerWithoutPhoto("+963939000091", "First");
    Account second = registerWithoutPhoto("+963939000092", "Second");

    registerDevice(first, "shared:device-token", "driver");
    registerDevice(first, "shared:device-token", "driver");
    assertThat(count("SELECT count(*) FROM device_tokens WHERE token = 'shared:device-token'"))
        .isEqualTo(1);

    registerDevice(second, "shared:device-token", "rider");
    Map<String, Object> row =
        jdbcTemplate.queryForMap(
            "SELECT user_id, app FROM device_tokens WHERE token = 'shared:device-token'");
    assertThat(row.get("user_id")).isEqualTo(second.userId());
    assertThat(row.get("app")).isEqualTo("rider");

    ok(delete("/api/v1/devices/shared:device-token", first.token()), HttpStatus.NO_CONTENT);
    assertThat(count("SELECT count(*) FROM device_tokens WHERE token = 'shared:device-token'"))
        .isEqualTo(1);
    ok(delete("/api/v1/devices/shared:device-token", second.token()), HttpStatus.NO_CONTENT);
    ok(delete("/api/v1/devices/shared:device-token", second.token()), HttpStatus.NO_CONTENT);
    assertThat(count("SELECT count(*) FROM device_tokens WHERE token = 'shared:device-token'"))
        .isZero();

    assertThat(
            put(
                    "/api/v1/devices",
                    Map.of("token", "", "platform", "android", "app", "driver"),
                    first.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            put(
                    "/api/v1/devices",
                    Map.of("token", "t", "platform", "symbian", "app", "driver"),
                    first.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            put("/api/v1/devices", Map.of("token", "t", "platform", "ios"), first.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }
}
