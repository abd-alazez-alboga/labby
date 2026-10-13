package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import com.labby.backend.util.RbacIds;
import java.time.Duration;
import java.time.Instant;
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
 * M10-T2 acceptance — SOS (SAFE-01/02, UC-S-16, UC-A-20): the permanent event with its clamped
 * device moment, repeat taps as repeat events, the alert fan-out to exactly the {@code
 * support:handle} admins, the filtered alert list, and the audited acknowledge path with its 409.
 * (Immutability of the stored facts is T1's CommsMigrationIntegrationTest.)
 */
class SosIntegrationTest extends AbstractRideIntegrationTest {

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;

  @BeforeEach
  void pushSucceeds() {
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of()));
  }

  private ResponseEntity<JsonNode> sos(Account account, UUID rideId, Instant recordedAt) {
    return post(
        "/api/v1/rides/" + rideId + "/sos",
        Map.of("lat", 33.502, "lng", 36.301, "recordedAt", recordedAt.toString()),
        account.token());
  }

  private UUID acceptedRide(Account rider, Account driver) {
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    return rideId;
  }

  /** An admin holding only {@code support:view} (no handle). */
  private String supportViewer(String phone) {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('Viewer "
                + phone
                + "', false)"
                + " RETURNING role_id",
            UUID.class);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = 'support:view'",
        roleId);
    return registerAdmin(phone, roleId);
  }

  private void registerAdminDevice(String adminToken, String deviceToken) {
    HttpHeaders headers = bearer(adminToken);
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", deviceToken, "platform", "web", "app", "admin"), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  @Test
  @DisplayName("SAFE-01: the event is recorded with a clamped recordedAt; repeat taps repeat")
  void shouldRecordEventsWithClampedMoment() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);

    // A device clock running ahead is clamped to server time.
    JsonNode event = ok(sos(rider, rideId, CLOCK.instant().plusSeconds(3600)), HttpStatus.CREATED);
    assertThat(Instant.parse(event.get("triggeredAt").asText())).isEqualTo(CLOCK.instant());
    assertThat(event.get("triggeredByRole").asText()).isEqualTo("rider");
    assertThat(event.get("lat").asDouble()).isEqualTo(33.502);
    // An honest past moment is kept.
    Instant past = CLOCK.instant().minusSeconds(5);
    assertThat(
            Instant.parse(
                ok(sos(driver, rideId, past), HttpStatus.CREATED).get("triggeredAt").asText()))
        .isEqualTo(past);
    // Repeat taps are repeat events — escalation is signal.
    ok(sos(rider, rideId, CLOCK.instant()), HttpStatus.CREATED);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM sos_events WHERE ride_id = ?", Integer.class, rideId))
        .isEqualTo(3);
  }

  @Test
  @DisplayName("SAFE-01: parties only, active accepted ride only")
  void shouldGateSosTrigger() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID requested = book(rider);
    ResponseEntity<JsonNode> early = sos(rider, requested, CLOCK.instant());
    assertThat(early.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(early)).isEqualTo("ride_not_active");

    dispatchAndAccept(requested, driver);
    Account stranger = rider();
    assertThat(sos(stranger, requested, CLOCK.instant()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("SAFE-01: the alert push goes to support:handle admins ONLY (category safety)")
  void shouldFanAlertOutToHandlersOnly() {
    // One admin WITH support:handle (the system Support role), one with support:view only.
    String handler = registerAdmin("+963937902001", RbacIds.SUPPORT_ROLE_ID);
    String viewer = supportViewer("+963937902002");
    UUID handlerId = userIdOf("+963937902001");
    UUID viewerId = userIdOf("+963937902002");
    registerAdminDevice(handler, "fcm-sos-handler");
    registerAdminDevice(viewer, "fcm-sos-viewer");

    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    ok(sos(rider, rideId, CLOCK.instant()), HttpStatus.CREATED);

    assertThat(outboxEvents(handlerId)).contains("sos.triggered");
    assertThat(outboxEvents(viewerId)).doesNotContain("sos.triggered");

    notificationDispatchService.dispatchPending();
    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushSender).send(Mockito.eq(List.of("fcm-sos-handler")), message.capture());
    assertThat(message.getValue().title()).isEqualTo("SOS alert");
    assertThat(message.getValue().data()).containsEntry("category", "safety");
  }

  @Test
  @DisplayName("UC-A-20: the alert list filters by status and region; acknowledge is audited")
  void shouldListAndAcknowledgeAlerts() {
    String handler = registerAdmin("+963937902011", RbacIds.SUPPORT_ROLE_ID);
    String viewer = supportViewer("+963937902012");
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    ok(sos(rider, rideId, CLOCK.instant()), HttpStatus.CREATED);
    advance(Duration.ofSeconds(1));
    ok(sos(driver, rideId, CLOCK.instant()), HttpStatus.CREATED);

    // Open alerts, newest first; the region filter matches the ride's region.
    JsonNode open = ok(get("/api/v1/admin/sos-events", viewer), HttpStatus.OK);
    assertThat(open.get("items")).hasSize(2);
    JsonNode newest = open.get("items").get(0);
    assertThat(newest.get("triggeredByRole").asText()).isEqualTo("driver");
    assertThat(newest.get("regionId").asText()).isEqualTo(regionId.toString());
    assertThat(newest.get("rideState").asText()).isEqualTo("accepted");
    assertThat(newest.get("triggeredBy").get("phone").asText()).isEqualTo(driver.phone());
    assertThat(newest.get("acknowledged").isNull()).isTrue();
    assertThat(
            ok(get("/api/v1/admin/sos-events?regionId=" + UUID.randomUUID(), viewer), HttpStatus.OK)
                .get("items"))
        .isEmpty();
    // Cursor paging walks the list without repeats.
    JsonNode first = ok(get("/api/v1/admin/sos-events?size=1", viewer), HttpStatus.OK);
    assertThat(first.get("items")).hasSize(1);
    JsonNode second =
        ok(
            get(
                "/api/v1/admin/sos-events?size=1&before=" + first.get("nextCursor").asText(),
                viewer),
            HttpStatus.OK);
    assertThat(second.get("items").get(0).get("sosEventId").asText())
        .isNotEqualTo(first.get("items").get(0).get("sosEventId").asText());

    // Acknowledge: support:handle only, once, audited; the facts stay (SAFE-02 — T1 covers DB).
    String sosEventId = newest.get("sosEventId").asText();
    assertThat(
            post("/api/v1/admin/sos-events/" + sosEventId + "/acknowledge", null, viewer)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    JsonNode acknowledged =
        ok(
            post(
                "/api/v1/admin/sos-events/" + sosEventId + "/acknowledge",
                Map.of("note", "called the rider, all fine"),
                handler),
            HttpStatus.OK);
    assertThat(acknowledged.get("acknowledged").get("note").asText())
        .isEqualTo("called the rider, all fine");
    assertThat(acknowledged.get("acknowledged").get("byName").asText()).isNotBlank();
    assertThat(auditActions(sosEventId)).containsExactly("sos.acknowledge");
    ResponseEntity<JsonNode> again =
        post("/api/v1/admin/sos-events/" + sosEventId + "/acknowledge", null, handler);
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("already_acknowledged");
    assertThat(
            post("/api/v1/admin/sos-events/" + UUID.randomUUID() + "/acknowledge", null, handler)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // Status filters: one open, one acknowledged, both under `all`.
    assertThat(ok(get("/api/v1/admin/sos-events?status=open", viewer), HttpStatus.OK).get("items"))
        .hasSize(1);
    assertThat(
            ok(get("/api/v1/admin/sos-events?status=acknowledged", viewer), HttpStatus.OK)
                .get("items"))
        .hasSize(1);
    assertThat(ok(get("/api/v1/admin/sos-events?status=all", viewer), HttpStatus.OK).get("items"))
        .hasSize(2);
    // The list itself is permission-gated: a party is no admin.
    assertThat(get("/api/v1/admin/sos-events", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  private UUID userIdOf(String phone) {
    return jdbcTemplate.queryForObject(
        "SELECT user_id FROM users WHERE phone = ?", UUID.class, phone);
  }
}
