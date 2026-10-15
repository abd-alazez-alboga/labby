package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import com.labby.backend.util.RbacIds;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * M10-T5 acceptance — the comms walkthrough on ONE real ride, driven through the real HTTP API and
 * the realtime WebSocket with a controlled clock: chat both ways (text + quick replies) with the
 * reconnect dedup and read relay; the chat push with its deep link to a backgrounded app whose
 * socket stays open, despite a mute while the ride is active; the call numbers (each party gets the
 * OTHER party's real phone) and their 24 h validity; the public share link tracking live and dying
 * at completion; SOS as a permanent event alerting exactly the {@code support:handle} admins,
 * flagging the live-ops map and the alert list, standing down on acknowledge; contact access on the
 * admin ride detail; and the full admin chat log after the ride.
 */
class CommsSimulatorIntegrationTest extends AbstractRideIntegrationTest {

  private static final long FRAME_WAIT_MS = 5000;
  private static final String SUPER_ADMIN_PHONE = "+963937900000";
  private static final String HANDLER_PHONE = "+963937905001";
  private static final String SUPPORT_VIEWER_PHONE = "+963937905002";
  private static final String RIDES_VIEWER_PHONE = "+963937905003";

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private ObjectMapper objectMapper;
  @LocalServerPort private int port;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final List<WebSocket> sockets = new ArrayList<>();

  @BeforeEach
  void pushSucceeds() {
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of()));
  }

  @AfterEach
  void closeSockets() {
    sockets.forEach(WebSocket::abort);
    sockets.clear();
  }

  @Test
  @DisplayName("chat, push, call, share, SOS and the admin views work end to end on one ride")
  void shouldWalkTheCommsStoryEndToEnd() throws Exception {
    // Three admins: Support (support:handle + support:view + rides:view), support:view only,
    // rides:view only — each with an admin web device so a wrong fan-out would be visible.
    String handler = registerAdmin(HANDLER_PHONE, RbacIds.SUPPORT_ROLE_ID);
    String supportViewer = adminWith(SUPPORT_VIEWER_PHONE, "support:view");
    String ridesViewer = adminWith(RIDES_VIEWER_PHONE, "rides:view");
    registerDevice(handler, "fcm-handler", "web", "admin");
    registerDevice(supportViewer, "fcm-support-viewer", "web", "admin");
    registerDevice(ridesViewer, "fcm-rides-viewer", "web", "admin");

    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);

    List<String> conversation = chatBothWays(rideId, rider, driver);
    callNumbersWhileOpen(rideId, rider, driver);
    String shareToken = shareTracksLive(rideId, rider, driver);
    conversation.add(pushToBackgroundedAppDespiteMute(rideId, rider, driver));
    sosAlertsHandlersAndFlagsOps(rideId, rider, driver, handler, supportViewer, ridesViewer);
    windowClosesAfterCompletion(rideId, rider, driver, shareToken, conversation.size());
    adminChatLog(rideId, supportViewer, conversation);
  }

  // ---- 1. chat both ways -----------------------------------------------------------------------

  /** Returns the conversation in order: text bodies, or quick-reply codes. */
  private List<String> chatBothWays(UUID rideId, Account rider, Account driver) throws Exception {
    JsonNode opened = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(opened.get("windowState").asText()).isEqualTo("open");

    Socket riderSocket = connect(rider);
    Socket driverSocket = connect(driver);
    List<String> conversation = new ArrayList<>();

    // Rider → driver (text): echo to the sender, the same message to the driver.
    UUID firstClientMsgId = UUID.randomUUID();
    sendFrame(riderSocket, textSend(rideId, firstClientMsgId, "I'm at the main gate"));
    JsonNode echo = next(riderSocket, "chat.message");
    assertThat(echo.get("clientMsgId").asText()).isEqualTo(firstClientMsgId.toString());
    JsonNode atDriver = next(driverSocket, "chat.message");
    assertThat(atDriver.get("messageId").asText()).isEqualTo(echo.get("messageId").asText());
    assertThat(atDriver.get("senderRole").asText()).isEqualTo("rider");
    assertThat(atDriver.get("body").asText()).isEqualTo("I'm at the main gate");
    String firstMessageId = echo.get("messageId").asText();
    conversation.add("I'm at the main gate");

    // Driver → rider (quick reply driver_on_my_way).
    advance(Duration.ofSeconds(1));
    sendFrame(driverSocket, quickReply(rideId, UUID.randomUUID(), "driver_on_my_way"));
    JsonNode onMyWay = next(riderSocket, "chat.message");
    assertThat(onMyWay.get("senderRole").asText()).isEqualTo("driver");
    assertThat(onMyWay.get("kind").asText()).isEqualTo("quick_reply");
    assertThat(onMyWay.get("quickReplyCode").asText()).isEqualTo("driver_on_my_way");
    // The rider's catalog holds no driver codes: the live frame carries the texts itself.
    assertThat(onMyWay.get("quickReply").get("textEn").asText()).isEqualTo("On my way");
    assertThat(onMyWay.get("quickReply").get("textAr").asText()).isEqualTo("أنا في الطريق");
    assertThat(next(driverSocket, "chat.message").get("messageId").asText())
        .isEqualTo(onMyWay.get("messageId").asText());
    conversation.add("driver_on_my_way");

    // The rider's socket drops; the app reconnects and resends the first message (same
    // clientMsgId): the stored message comes back, no duplicate row.
    riderSocket.socket().abort();
    riderSocket = connect(rider);
    sendFrame(riderSocket, textSend(rideId, firstClientMsgId, "I'm at the main gate"));
    JsonNode resent = next(riderSocket, "chat.message");
    assertThat(resent.get("messageId").asText()).isEqualTo(firstMessageId);
    assertThat(messageRows(rideId)).isEqualTo(2);

    // Rider → driver (quick reply rider_coming).
    advance(Duration.ofSeconds(1));
    sendFrame(riderSocket, quickReply(rideId, UUID.randomUUID(), "rider_coming"));
    String comingId = next(riderSocket, "chat.message").get("messageId").asText();
    JsonNode coming = next(driverSocket, "chat.message");
    assertThat(coming.get("messageId").asText()).isEqualTo(comingId);
    assertThat(coming.get("quickReplyCode").asText()).isEqualTo("rider_coming");
    conversation.add("rider_coming");

    // Driver → rider (text).
    advance(Duration.ofSeconds(1));
    sendFrame(driverSocket, textSend(rideId, UUID.randomUUID(), "White Rio, two minutes"));
    assertThat(next(riderSocket, "chat.message").get("body").asText())
        .isEqualTo("White Rio, two minutes");
    next(driverSocket, "chat.message");
    conversation.add("White Rio, two minutes");

    // chat.read: the driver marks the rider's latest message read; the rider sees the marker.
    Map<String, Object> read = new LinkedHashMap<>();
    read.put("type", "chat.read");
    read.put("rideId", rideId.toString());
    read.put("lastReadMessageId", comingId);
    sendFrame(driverSocket, read);
    JsonNode relayed = next(riderSocket, "chat.read");
    assertThat(relayed.get("readerRole").asText()).isEqualTo("driver");
    assertThat(relayed.get("lastReadMessageId").asText()).isEqualTo(comingId);
    assertThat(
            ok(thread(rider, rideId), HttpStatus.OK).get("counterpartLastReadMessageId").asText())
        .isEqualTo(comingId);
    assertThat(messageRows(rideId)).isEqualTo(4);
    return conversation;
  }

  // ---- 3a. call numbers while the window is open -----------------------------------------------

  private void callNumbersWhileOpen(UUID rideId, Account rider, Account driver) {
    // The number the dialer gets is the OTHER party's real phone.
    JsonNode riderView = ok(thread(rider, rideId), HttpStatus.OK).get("counterpart");
    assertThat(riderView.get("role").asText()).isEqualTo("driver");
    assertThat(riderView.get("phone").asText()).isEqualTo(driver.phone());
    JsonNode driverView = ok(thread(driver, rideId), HttpStatus.OK).get("counterpart");
    assertThat(driverView.get("role").asText()).isEqualTo("rider");
    assertThat(driverView.get("phone").asText()).isEqualTo(rider.phone());
  }

  // ---- 4. share link tracks live ---------------------------------------------------------------

  private String shareTracksLive(UUID rideId, Account rider, Account driver) {
    JsonNode link =
        ok(
            post("/api/v1/rides/" + rideId + "/share-links", null, rider.token()),
            HttpStatus.CREATED);
    String url = link.get("url").asText();
    String token = url.substring(url.lastIndexOf('/') + 1);

    JsonNode first = ok(publicGet("/api/v1/share/" + token), HttpStatus.OK);
    List<String> fields = new ArrayList<>();
    first.fieldNames().forEachRemaining(fields::add);
    assertThat(fields)
        .containsExactlyInAnyOrder(
            "status",
            "driverFirstName",
            "driverPhotoUrl",
            "vehicle",
            "position",
            "etaSeconds",
            "refreshSeconds");
    assertThat(first.get("status").asText()).isEqualTo("accepted");
    assertThat(first.get("position").get("lat").asDouble()).isEqualTo(33.501);
    assertThat(first.get("position").get("lng").asDouble()).isEqualTo(36.30);

    // The driver moves between two polls: the second poll shows the new fix.
    position(driver, 33.5005, 36.3002);
    JsonNode second = ok(publicGet("/api/v1/share/" + token), HttpStatus.OK);
    assertThat(second.get("position").get("lat").asDouble()).isEqualTo(33.5005);
    assertThat(second.get("position").get("lng").asDouble()).isEqualTo(36.3002);

    // The trip starts: the shared status follows.
    arriveAndStart(rideId, driver);
    JsonNode inRide = ok(publicGet("/api/v1/share/" + token), HttpStatus.OK);
    assertThat(inRide.get("status").asText()).isEqualTo("in_progress");
    assertThat(inRide.get("position").get("lat").asDouble()).isEqualTo(PICKUP_LAT);
    return token;
  }

  // ---- 2. push to a backgrounded app (socket still open), muted chat bypassed while active ----

  /** Returns the pushed message's body (part of the conversation). */
  private String pushToBackgroundedAppDespiteMute(UUID rideId, Account rider, Account driver)
      throws Exception {
    // Deliver everything queued so far (no devices yet for the parties), then arm the driver.
    notificationDispatchService.dispatchPending();
    Mockito.clearInvocations(pushSender);
    registerDevice(driver.token(), "fcm-driver", "android", "driver");
    mute(driver, "chat");

    // The driver's app goes to background but keeps its socket open (location streaming): the
    // push is queued anyway (owner ruling 2026-10-14) and the live frame still arrives.
    Socket driverSocket = connect(driver);
    int queuedBefore = chatOutboxRows(driver.userId());
    advance(Duration.ofSeconds(1));
    Socket riderSocket = connect(rider);
    String body = "Grey backpack, by the pharmacy";
    sendFrame(riderSocket, textSend(rideId, UUID.randomUUID(), body));
    next(riderSocket, "chat.message");
    assertThat(next(driverSocket, "chat.message").get("body").asText()).isEqualTo(body);
    assertThat(chatOutboxRows(driver.userId())).isEqualTo(queuedBefore + 1);

    notificationDispatchService.dispatchPending();
    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushSender).send(Mockito.eq(List.of("fcm-driver")), message.capture());
    assertThat(message.getValue().data())
        .containsEntry("category", "chat")
        .containsEntry("event", "chat.message")
        .containsEntry("screen", "chat")
        .containsEntry("params", "{\"rideId\":\"" + rideId + "\"}");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT push_status FROM notifications WHERE user_id = ? AND event ="
                    + " 'chat.message' ORDER BY created_at DESC LIMIT 1",
                String.class,
                driver.userId()))
        .isEqualTo("sent");
    return body;
  }

  // ---- 5. SOS ----------------------------------------------------------------------------------

  private void sosAlertsHandlersAndFlagsOps(
      UUID rideId,
      Account rider,
      Account driver,
      String handler,
      String supportViewer,
      String ridesViewer) {
    Mockito.clearInvocations(pushSender);
    JsonNode event =
        ok(
            post(
                "/api/v1/rides/" + rideId + "/sos",
                Map.of("lat", 33.502, "lng", 36.301, "recordedAt", CLOCK.instant().toString()),
                rider.token()),
            HttpStatus.CREATED);
    String sosEventId = event.get("sosEventId").asText();
    assertThat(event.get("triggeredByRole").asText()).isEqualTo("rider");

    // Permanent: the database itself refuses the DELETE.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM sos_events WHERE sos_event_id = ?", UUID.fromString(sosEventId)))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("permanent");

    // The alert is queued to exactly the support:handle holders (Support + the fixture's Super
    // Admin); the support:view-only and rides:view-only admins get nothing.
    assertThat(sosRecipients())
        .containsExactlyInAnyOrder(userIdOf(HANDLER_PHONE), userIdOf(SUPER_ADMIN_PHONE));
    assertThat(outboxEvents(userIdOf(SUPPORT_VIEWER_PHONE))).doesNotContain("sos.triggered");
    assertThat(outboxEvents(userIdOf(RIDES_VIEWER_PHONE))).doesNotContain("sos.triggered");
    notificationDispatchService.dispatchPending();
    ArgumentCaptor<List<String>> tokens = listCaptor();
    ArgumentCaptor<PushMessage> pushes = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushSender, atLeastOnce()).send(tokens.capture(), pushes.capture());
    List<List<String>> safetyTargets = new ArrayList<>();
    for (int i = 0; i < pushes.getAllValues().size(); i++) {
      if ("safety".equals(pushes.getAllValues().get(i).data().get("category"))) {
        safetyTargets.add(tokens.getAllValues().get(i));
      }
    }
    assertThat(safetyTargets).containsExactly(List.of("fcm-handler"));
    assertThat(tokens.getAllValues())
        .flatMap(list -> list)
        .doesNotContain("fcm-support-viewer", "fcm-rides-viewer");

    // Live ops (rides:view): the ride is red and the open SOS is pinned.
    JsonNode flagged = liveOps(ridesViewer);
    JsonNode ride = rideIn(flagged, rideId);
    assertThat(ride.get("state").asText()).isEqualTo("in_progress");
    assertThat(ride.get("sosOpen").asBoolean()).isTrue();
    assertThat(flagged.get("sosEvents")).hasSize(1);
    assertThat(flagged.get("sosEvents").get(0).get("sosEventId").asText()).isEqualTo(sosEventId);
    assertThat(flagged.get("sosEvents").get(0).get("rideId").asText()).isEqualTo(rideId.toString());

    // The alert list (support:view) shows it open.
    JsonNode open = ok(get("/api/v1/admin/sos-events", supportViewer), HttpStatus.OK);
    assertThat(open.get("items")).hasSize(1);
    assertThat(open.get("items").get(0).get("sosEventId").asText()).isEqualTo(sosEventId);
    assertThat(open.get("items").get(0).get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(open.get("items").get(0).get("acknowledged").isNull()).isTrue();

    // Contact access on the ride detail: phones for support:handle, null for rides:view only.
    JsonNode withContact = ok(get("/api/v1/admin/rides/" + rideId, handler), HttpStatus.OK);
    assertThat(withContact.get("riderPhone").asText()).isEqualTo(rider.phone());
    assertThat(withContact.get("driverPhone").asText()).isEqualTo(driver.phone());
    JsonNode withoutContact = ok(get("/api/v1/admin/rides/" + rideId, ridesViewer), HttpStatus.OK);
    assertThat(withoutContact.get("riderPhone").isNull()).isTrue();
    assertThat(withoutContact.get("driverPhone").isNull()).isTrue();
    assertThat(withoutContact.get("riderUserId").asText()).isEqualTo(rider.userId().toString());

    // Acknowledge (stand-down): the pin leaves the map, the event and its facts stay.
    advance(Duration.ofMinutes(2));
    ok(
        post(
            "/api/v1/admin/sos-events/" + sosEventId + "/acknowledge",
            Map.of("note", "called the rider, all fine"),
            handler),
        HttpStatus.OK);
    JsonNode afterAck = liveOps(ridesViewer);
    assertThat(afterAck.get("sosEvents")).isEmpty();
    assertThat(rideIn(afterAck, rideId).get("sosOpen").asBoolean()).isFalse();
    assertThat(
            ok(get("/api/v1/admin/sos-events?status=open", supportViewer), HttpStatus.OK)
                .get("items"))
        .isEmpty();
    JsonNode all = ok(get("/api/v1/admin/sos-events?status=all", supportViewer), HttpStatus.OK);
    assertThat(all.get("items")).hasSize(1);
    JsonNode kept = all.get("items").get(0);
    assertThat(kept.get("sosEventId").asText()).isEqualTo(sosEventId);
    assertThat(kept.get("triggeredByRole").asText()).isEqualTo("rider");
    assertThat(kept.get("lat").asDouble()).isEqualTo(33.502);
    assertThat(kept.get("lng").asDouble()).isEqualTo(36.301);
    assertThat(kept.get("triggeredAt").asText()).isEqualTo(event.get("triggeredAt").asText());
    assertThat(kept.get("acknowledged").get("note").asText())
        .isEqualTo("called the rider, all fine");
  }

  // ---- 3b + 4b. completion: share dies, the window closes after 24 h ---------------------------

  private void windowClosesAfterCompletion(
      UUID rideId, Account rider, Account driver, String shareToken, int messages)
      throws Exception {
    advance(Duration.ofMinutes(8));
    position(driver, DEST_LAT, DEST_LNG);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    // The share link is dead for ever at completion.
    assertThat(publicGet("/api/v1/share/" + shareToken).getStatusCode()).isEqualTo(HttpStatus.GONE);

    // Inside the 24 h tail the number is still served.
    advance(Duration.ofHours(23));
    assertThat(ok(thread(rider, rideId), HttpStatus.OK).get("counterpart").get("phone").asText())
        .isEqualTo(driver.phone());

    // Past completion + 24 h: no number for either party, writes refused, history kept.
    advance(Duration.ofHours(1).plusSeconds(1));
    JsonNode riderClosed = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(riderClosed.get("windowState").asText()).isEqualTo("read_only");
    assertThat(riderClosed.get("counterpart").get("phone").isNull()).isTrue();
    assertThat(ok(thread(driver, rideId), HttpStatus.OK).get("counterpart").get("phone").isNull())
        .isTrue();
    Socket late = connect(driver);
    sendFrame(late, textSend(rideId, UUID.randomUUID(), "still there?"));
    assertThat(next(late, "error").get("code").asText()).isEqualTo("chat_closed");
    assertThat(messageRows(rideId)).isEqualTo(messages);
    JsonNode history =
        ok(get("/api/v1/rides/" + rideId + "/chat/messages", rider.token()), HttpStatus.OK);
    assertThat(history.get("items")).hasSize(messages);
  }

  // ---- 6. admin chat log -----------------------------------------------------------------------

  private void adminChatLog(UUID rideId, String supportViewer, List<String> conversation) {
    JsonNode log = ok(get("/api/v1/admin/rides/" + rideId + "/chat", supportViewer), HttpStatus.OK);
    assertThat(log.get("windowState").asText()).isEqualTo("read_only");
    List<String> logged = new ArrayList<>();
    List<String> senders = new ArrayList<>();
    for (JsonNode item : log.get("items")) {
      logged.add(
          "text".equals(item.get("kind").asText())
              ? item.get("body").asText()
              : item.get("quickReply").get("code").asText());
      senders.add(item.get("senderRole").asText());
    }
    assertThat(logged).containsExactlyElementsOf(conversation);
    assertThat(senders).containsExactly("rider", "driver", "rider", "driver", "rider");
    assertThat(auditActions(rideId.toString())).contains("chat.view");
  }

  // ---- fixtures --------------------------------------------------------------------------------

  /** An admin whose custom role holds exactly one permission. */
  private String adminWith(String phone, String permission) {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES (?, false) RETURNING role_id",
            UUID.class,
            "Only " + permission);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = ?",
        roleId,
        permission);
    return registerAdmin(phone, roleId);
  }

  private void registerDevice(String accessToken, String deviceToken, String platform, String app) {
    HttpHeaders headers = bearer(accessToken);
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", deviceToken, "platform", platform, "app", app), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  private void mute(Account account, String category) {
    ok(
        put(
            "/api/v1/notifications/preferences",
            List.of(Map.of("category", category, "enabled", false)),
            account.token()),
        HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> thread(Account account, UUID rideId) {
    return get("/api/v1/rides/" + rideId + "/chat", account.token());
  }

  /** A public GET with NO Authorization header (the plain browser). */
  private ResponseEntity<JsonNode> publicGet(String path) {
    return restTemplate.exchange(
        path, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), JsonNode.class);
  }

  private JsonNode liveOps(String adminToken) {
    return ok(get("/api/v1/admin/regions/" + regionId + "/live-ops", adminToken), HttpStatus.OK);
  }

  private static JsonNode rideIn(JsonNode snapshot, UUID rideId) {
    for (JsonNode ride : snapshot.get("rides")) {
      if (ride.get("rideId").asText().equals(rideId.toString())) {
        return ride;
      }
    }
    throw new AssertionError("ride " + rideId + " not on the live-ops map");
  }

  private int messageRows(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM chat_messages m JOIN chat_threads t ON t.chat_thread_id ="
            + " m.thread_id WHERE t.ride_id = ?",
        Integer.class,
        rideId);
  }

  private int chatOutboxRows(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM notification_outbox WHERE user_id = ? AND event = 'chat.message'",
        Integer.class,
        userId);
  }

  private List<UUID> sosRecipients() {
    return jdbcTemplate.queryForList(
        "SELECT user_id FROM notification_outbox WHERE event = 'sos.triggered'", UUID.class);
  }

  private UUID userIdOf(String phone) {
    return jdbcTemplate.queryForObject(
        "SELECT user_id FROM users WHERE phone = ?", UUID.class, phone);
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private static ArgumentCaptor<List<String>> listCaptor() {
    return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
  }

  // ---- WS harness (ChatIntegrationTest pattern) ------------------------------------------------

  private record Socket(WebSocket socket, BlockingQueue<JsonNode> frames) {}

  private Socket connect(Account account) throws Exception {
    BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>();
    WebSocket socket =
        httpClient
            .newWebSocketBuilder()
            .buildAsync(
                URI.create("ws://localhost:" + port + "/api/v1/realtime"),
                new WebSocket.Listener() {
                  private final StringBuilder partial = new StringBuilder();

                  @Override
                  public CompletionStage<?> onText(
                      WebSocket webSocket, CharSequence data, boolean last) {
                    partial.append(data);
                    if (last) {
                      try {
                        frames.add(objectMapper.readTree(partial.toString()));
                      } catch (Exception ex) {
                        throw new IllegalStateException(ex);
                      }
                      partial.setLength(0);
                    }
                    webSocket.request(1);
                    return null;
                  }
                })
            .join();
    sockets.add(socket);
    socket
        .sendText(
            objectMapper.writeValueAsString(Map.of("type", "auth", "token", account.token())), true)
        .get(5, TimeUnit.SECONDS);
    Socket wrapped = new Socket(socket, frames);
    assertThat(next(wrapped, "ready").get("userId").asText())
        .isEqualTo(account.userId().toString());
    return wrapped;
  }

  private void sendFrame(Socket socket, Map<String, Object> frame) throws Exception {
    socket.socket().sendText(objectMapper.writeValueAsString(frame), true).get(5, TimeUnit.SECONDS);
  }

  private static JsonNode next(Socket socket, String type) throws Exception {
    long deadline = System.currentTimeMillis() + FRAME_WAIT_MS;
    while (System.currentTimeMillis() < deadline) {
      JsonNode frame =
          socket.frames().poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
      if (frame != null && type.equals(frame.path("type").asText())) {
        return frame;
      }
    }
    throw new AssertionError("no " + type + " frame within " + FRAME_WAIT_MS + " ms");
  }

  private static Map<String, Object> textSend(UUID rideId, UUID clientMsgId, String body) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.send");
    frame.put("rideId", rideId.toString());
    frame.put("clientMsgId", clientMsgId.toString());
    frame.put("kind", "text");
    frame.put("body", body);
    return frame;
  }

  private static Map<String, Object> quickReply(UUID rideId, UUID clientMsgId, String code) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.send");
    frame.put("rideId", rideId.toString());
    frame.put("clientMsgId", clientMsgId.toString());
    frame.put("kind", "quick_reply");
    frame.put("quickReplyCode", code);
    return frame;
  }
}
