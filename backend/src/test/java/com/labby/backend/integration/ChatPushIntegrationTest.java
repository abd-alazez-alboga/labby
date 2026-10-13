package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.service.ChatService;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.ArrayList;
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
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * M10-T2 acceptance — the chat push (CHAT-02 + the ride-critical ruling): an offline recipient gets
 * a push (deep link {@code {screen: chat, params: {rideId}}}), a live socket suppresses it, a muted
 * {@code chat} category is bypassed while the ride is ACTIVE and honoured after the ride ends — the
 * center row recorded either way (UC-S-25 A1).
 */
class ChatPushIntegrationTest extends AbstractRideIntegrationTest {

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private ChatService chatService;
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

  private void registerDevice(Account account, String token, String app) {
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", token, "platform", "android", "app", app), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  private void mute(Account account, String category) {
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/notifications/preferences",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        List.of(Map.of("category", category, "enabled", false)), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  /**
   * Delivers the fixture's own onboarding/ride notifications (no device yet) so the assertions
   * below see only the chat push.
   */
  private void drainOnboardingPushes() {
    notificationDispatchService.dispatchPending();
    Mockito.clearInvocations(pushSender);
  }

  /** Sends a text through the service's WS path (the sender needs no socket for a push test). */
  private void send(Account sender, UUID rideId, String body) {
    chatService.send(
        sender.userId(),
        new ChatService.SendRequest(rideId, UUID.randomUUID(), "text", body, null));
  }

  private String pushStatus(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT push_status FROM notifications WHERE user_id = ? AND event = 'chat.message'"
            + " ORDER BY created_at DESC LIMIT 1",
        String.class,
        userId);
  }

  private int chatOutboxRows(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM notification_outbox WHERE user_id = ? AND event = 'chat.message'",
        Integer.class,
        userId);
  }

  @Test
  @DisplayName("CHAT-02: an offline recipient gets the push with the chat deep link")
  void shouldPushToOfflineRecipient() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    drainOnboardingPushes();
    registerDevice(driver, "fcm-chat-driver", "driver");

    send(rider, rideId, "I'm wearing a red jacket");
    assertThat(chatOutboxRows(driver.userId())).isEqualTo(1);
    notificationDispatchService.dispatchPending();

    ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
    verify(pushSender).send(Mockito.eq(List.of("fcm-chat-driver")), message.capture());
    assertThat(message.getValue().title()).isEqualTo("New message");
    assertThat(message.getValue().body()).contains("Rana");
    assertThat(message.getValue().data())
        .containsEntry("category", "chat")
        .containsEntry("event", "chat.message")
        .containsEntry("screen", "chat")
        .containsEntry("params", "{\"rideId\":\"" + rideId + "\"}");
    assertThat(pushStatus(driver.userId())).isEqualTo("sent");
  }

  @Test
  @DisplayName("ride-critical ruling: a muted chat category is bypassed while the ride is active")
  void shouldBypassMuteWhileRideIsActive() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    drainOnboardingPushes();
    registerDevice(driver, "fcm-chat-muted", "driver");
    mute(driver, "chat");

    send(rider, rideId, "on my way down");
    notificationDispatchService.dispatchPending();

    // Delivered despite the mute — in-ride chat is ride-critical (NTF-02's exception).
    assertThat(pushStatus(driver.userId())).isEqualTo("sent");
    verify(pushSender).send(anyList(), any());
  }

  @Test
  @DisplayName("after the ride ends the mute applies; the center row is still recorded")
  void shouldHonourMuteAfterRideEnds() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    position(driver, DEST_LAT, DEST_LNG);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    drainOnboardingPushes();
    registerDevice(driver, "fcm-chat-tail", "driver");
    mute(driver, "chat");

    // The 24 h tail is writable, but its pushes are ordinary chat pushes: the mute holds.
    send(rider, rideId, "I think I left my scarf");
    notificationDispatchService.dispatchPending();

    verify(pushSender, Mockito.never()).send(anyList(), any());
    assertThat(pushStatus(driver.userId())).isEqualTo("muted");
    // UC-S-25 A1: the center row exists either way.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM notifications WHERE user_id = ? AND event = 'chat.message'",
                Integer.class,
                driver.userId()))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("a recipient with a live socket gets the frame, not a push")
  void shouldNotPushToLiveSocket() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    drainOnboardingPushes();
    registerDevice(driver, "fcm-chat-live", "driver");
    BlockingQueue<JsonNode> driverFrames = connect(driver);

    send(rider, rideId, "see you soon");

    // The message reaches the live socket; no outbox push is queued for the recipient.
    JsonNode frame = next(driverFrames, "chat.message");
    assertThat(frame.get("body").asText()).isEqualTo("see you soon");
    assertThat(chatOutboxRows(driver.userId())).isZero();
    notificationDispatchService.dispatchPending();
    verify(pushSender, Mockito.never()).send(anyList(), any());
  }

  // ---- WS harness (recipient side only) --------------------------------------------------------

  private BlockingQueue<JsonNode> connect(Account account) throws Exception {
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
    assertThat(next(frames, "ready").get("userId").asText()).isEqualTo(account.userId().toString());
    return frames;
  }

  private static JsonNode next(BlockingQueue<JsonNode> frames, String type) throws Exception {
    long deadline = System.currentTimeMillis() + 5000;
    while (System.currentTimeMillis() < deadline) {
      JsonNode frame = frames.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
      if (frame != null && type.equals(frame.path("type").asText())) {
        return frame;
      }
    }
    throw new AssertionError("no " + type + " frame within 5000 ms");
  }
}
