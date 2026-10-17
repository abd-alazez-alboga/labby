package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.dto.ChatMessageDto;
import com.labby.backend.service.ChatService;
import com.labby.backend.util.RbacIds;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * M10-T2 acceptance — chat (CHAT-01..03, CALL-01, comms-v1.yaml): the window edges around
 * acceptance, the 24 h tail after completion AND post-acceptance cancellation, the reopened hook,
 * reconnection dedup on {@code clientMsgId}, read markers over both transports, the quick-reply
 * catalog with its audience filter, history paging / backfill, and the audited admin log.
 */
class ChatIntegrationTest extends AbstractRideIntegrationTest {

  private static final long FRAME_WAIT_MS = 5000;

  @LocalServerPort private int port;
  @Autowired private ObjectMapper objectMapper;
  @Autowired private ChatService chatService;
  @Autowired private PlatformTransactionManager transactionManager;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final List<WebSocket> sockets = new ArrayList<>();

  @AfterEach
  void closeSockets() {
    sockets.forEach(WebSocket::abort);
    sockets.clear();
  }

  // ---- WS harness (RideRealtimeIntegrationTest pattern) ---------------------------------------

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
    assertThat(next(frames, "ready").get("userId").asText()).isEqualTo(account.userId().toString());
    return new Socket(socket, frames);
  }

  private void sendFrame(Socket socket, Map<String, Object> frame) throws Exception {
    socket.socket().sendText(objectMapper.writeValueAsString(frame), true).get(5, TimeUnit.SECONDS);
  }

  private static JsonNode next(BlockingQueue<JsonNode> frames, String type) throws Exception {
    return next(frames, type, FRAME_WAIT_MS);
  }

  private static JsonNode next(BlockingQueue<JsonNode> frames, String type, long waitMs)
      throws Exception {
    long deadline = System.currentTimeMillis() + waitMs;
    while (System.currentTimeMillis() < deadline) {
      JsonNode frame = frames.poll(deadline - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
      if (frame != null && type.equals(frame.path("type").asText())) {
        return frame;
      }
    }
    throw new AssertionError("no " + type + " frame within " + waitMs + " ms");
  }

  private Map<String, Object> textSend(UUID rideId, UUID clientMsgId, String body) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.send");
    frame.put("rideId", rideId.toString());
    frame.put("clientMsgId", clientMsgId.toString());
    frame.put("kind", "text");
    frame.put("body", body);
    return frame;
  }

  // ---- REST helpers ----------------------------------------------------------------------------

  private ResponseEntity<JsonNode> thread(Account account, UUID rideId) {
    return get("/api/v1/rides/" + rideId + "/chat", account.token());
  }

  private JsonNode sendOverSocket(Socket socket, UUID rideId, String body) throws Exception {
    sendFrame(socket, textSend(rideId, UUID.randomUUID(), body));
    return next(socket.frames(), "chat.message");
  }

  private UUID acceptedRide(Account rider, Account driver) {
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    return rideId;
  }

  private int messageRows(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM chat_messages m JOIN chat_threads t ON t.chat_thread_id ="
            + " m.thread_id WHERE t.ride_id = ?",
        Integer.class,
        rideId);
  }

  // ---- window edges ----------------------------------------------------------------------------

  @Test
  @DisplayName("CHAT-01: no thread before acceptance — 404 on REST, chat_not_open over WS")
  void shouldRefuseChatBeforeAcceptance() throws Exception {
    Account rider = rider();
    driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    assertThat(thread(rider, rideId).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/rides/" + rideId + "/chat/messages", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    Socket socket = connect(rider);
    sendFrame(socket, textSend(rideId, UUID.randomUUID(), "hello?"));
    JsonNode error = next(socket.frames(), "error");
    assertThat(error.get("code").asText()).isEqualTo("chat_not_open");
    assertThat(messageRows(rideId)).isZero();
  }

  @Test
  @DisplayName("CHAT-01/CALL-01: open from acceptance through in_progress — fan-out to both")
  void shouldOpenChatFromAcceptance() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);

    JsonNode riderThread = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(riderThread.get("windowState").asText()).isEqualTo("open");
    assertThat(riderThread.get("closedAt").isNull()).isTrue();
    assertThat(riderThread.get("counterpart").get("role").asText()).isEqualTo("driver");
    assertThat(riderThread.get("counterpart").get("firstName").asText()).isEqualTo("Driver");
    // CALL-01: the real phone while writes are allowed; the driver's photo as an expiring url.
    assertThat(riderThread.get("counterpart").get("phone").asText()).isEqualTo(driver.phone());
    assertThat(riderThread.get("counterpart").get("photoUrl").isNull()).isFalse();
    JsonNode driverThread = ok(thread(driver, rideId), HttpStatus.OK);
    assertThat(driverThread.get("counterpart").get("role").asText()).isEqualTo("rider");
    assertThat(driverThread.get("counterpart").get("phone").asText()).isEqualTo(rider.phone());
    assertThat(driverThread.get("counterpart").get("photoUrl").isNull()).isTrue();

    // A stranger is no party: 403 on the thread, not_in_ride over WS.
    Account stranger = rider();
    assertThat(thread(stranger, rideId).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    Socket strangerSocket = connect(stranger);
    sendFrame(strangerSocket, textSend(rideId, UUID.randomUUID(), "let me in"));
    assertThat(next(strangerSocket.frames(), "error").get("code").asText())
        .isEqualTo("not_in_ride");

    Socket riderSocket = connect(rider);
    Socket driverSocket = connect(driver);
    UUID clientMsgId = UUID.randomUUID();
    sendFrame(riderSocket, textSend(rideId, clientMsgId, "I'm at the gate"));
    JsonNode echo = next(riderSocket.frames(), "chat.message");
    // The sender recognizes its echo (the delivery ack) by clientMsgId.
    assertThat(echo.get("clientMsgId").asText()).isEqualTo(clientMsgId.toString());
    assertThat(echo.get("senderRole").asText()).isEqualTo("rider");
    assertThat(echo.get("body").asText()).isEqualTo("I'm at the gate");
    JsonNode received = next(driverSocket.frames(), "chat.message");
    assertThat(received.get("messageId").asText()).isEqualTo(echo.get("messageId").asText());
    assertThat(received.has("clientMsgId")).isFalse();

    // Still open while in progress; a quick reply flows back.
    arriveAndStart(rideId, driver);
    Map<String, Object> quickReply = new LinkedHashMap<>();
    quickReply.put("type", "chat.send");
    quickReply.put("rideId", rideId.toString());
    quickReply.put("clientMsgId", UUID.randomUUID().toString());
    quickReply.put("kind", "quick_reply");
    quickReply.put("quickReplyCode", "both_okay");
    sendFrame(driverSocket, quickReply);
    JsonNode reply = next(riderSocket.frames(), "chat.message");
    assertThat(reply.get("kind").asText()).isEqualTo("quick_reply");
    assertThat(reply.get("quickReplyCode").asText()).isEqualTo("both_okay");

    // The REST page serves the localized quick reply, oldest first.
    JsonNode page =
        ok(get("/api/v1/rides/" + rideId + "/chat/messages", rider.token()), HttpStatus.OK);
    assertThat(page.get("items")).hasSize(2);
    assertThat(page.get("items").get(0).get("body").asText()).isEqualTo("I'm at the gate");
    assertThat(page.get("items").get(1).get("quickReply").get("textAr").asText()).isEqualTo("تمام");
    assertThat(page.get("nextCursor").isNull()).isTrue();
  }

  @Test
  @DisplayName("CHAT-01: completion stamps closed_at = completion + 24 h; the tail stays writable")
  void shouldKeepWindowFor24HoursAfterCompletion() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    arriveAndStart(rideId, driver);
    advance(Duration.ofMinutes(10));
    position(driver, DEST_LAT, DEST_LNG);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    OffsetDateTime closedAt =
        jdbcTemplate.queryForObject(
            "SELECT closed_at FROM chat_threads WHERE ride_id = ?", OffsetDateTime.class, rideId);
    assertThat(closedAt.toInstant()).isEqualTo(CLOCK.instant().plus(Duration.ofHours(24)));

    // Within the tail: still open, phone still served, writes still accepted.
    advance(Duration.ofHours(23));
    JsonNode tail = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(tail.get("windowState").asText()).isEqualTo("open");
    assertThat(tail.get("counterpart").get("phone").asText()).isEqualTo(driver.phone());
    Socket riderSocket = connect(rider);
    assertThat(sendOverSocket(riderSocket, rideId, "left my keys").get("body").asText())
        .isEqualTo("left my keys");

    // Past the tail: read-only — history stays, writes refused, phone hidden (CALL-01 window).
    advance(Duration.ofHours(1).plusSeconds(1));
    JsonNode closed = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(closed.get("windowState").asText()).isEqualTo("read_only");
    assertThat(closed.get("counterpart").get("phone").isNull()).isTrue();
    assertThat(
            ok(get("/api/v1/rides/" + rideId + "/chat/messages", rider.token()), HttpStatus.OK)
                .get("items"))
        .hasSize(1);
    Socket lateSocket = connect(rider);
    sendFrame(lateSocket, textSend(rideId, UUID.randomUUID(), "too late"));
    assertThat(next(lateSocket.frames(), "error").get("code").asText()).isEqualTo("chat_closed");
    assertThat(messageRows(rideId)).isEqualTo(1);

    // The M14 lost-item hook: a future reopened_until makes the window writable again.
    jdbcTemplate.update(
        "UPDATE chat_threads SET reopened_until = ? WHERE ride_id = ?",
        OffsetDateTime.ofInstant(CLOCK.instant().plus(Duration.ofHours(1)), ZoneOffset.UTC),
        rideId);
    JsonNode reopened = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(reopened.get("windowState").asText()).isEqualTo("reopened");
    assertThat(reopened.get("counterpart").get("phone").asText()).isEqualTo(driver.phone());
    Socket reopenedSocket = connect(rider);
    assertThat(sendOverSocket(reopenedSocket, rideId, "found them?").get("body").asText())
        .isEqualTo("found them?");
  }

  @Test
  @DisplayName("CHAT-01 owner ruling: a post-acceptance cancellation keeps the same 24 h window")
  void shouldKeepWindowAfterPostAcceptanceCancellation() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    ok(
        post(
            "/api/v1/rides/" + rideId + "/cancel", Map.of("reason", "changed_mind"), rider.token()),
        HttpStatus.OK);

    // The cancelled ride's thread stays writable through the tail (dispute trail).
    JsonNode cancelled = ok(thread(rider, rideId), HttpStatus.OK);
    assertThat(cancelled.get("windowState").asText()).isEqualTo("open");
    Socket riderSocket = connect(rider);
    assertThat(sendOverSocket(riderSocket, rideId, "sorry!").get("body").asText())
        .isEqualTo("sorry!");

    advance(Duration.ofHours(24).plusSeconds(1));
    assertThat(ok(thread(rider, rideId), HttpStatus.OK).get("windowState").asText())
        .isEqualTo("read_only");

    // A ride never accepted gets no thread at all (pre-acceptance cancel).
    UUID unaccepted = book(rider);
    ok(
        post(
            "/api/v1/rides/" + unaccepted + "/cancel",
            Map.of("reason", "changed_mind"),
            rider.token()),
        HttpStatus.OK);
    assertThat(thread(rider, unaccepted).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }

  // ---- reconnection / dedup --------------------------------------------------------------------

  @Test
  @DisplayName("UC-S-13 E1: a CONCURRENT duplicate send stores one row and pushes/frames once")
  void shouldFanOutOnceForConcurrentDuplicates() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    Socket driverSocket = connect(driver);
    ChatService.SendRequest request =
        new ChatService.SendRequest(rideId, UUID.randomUUID(), "text", "at the gate", null, null);
    CountDownLatch winnerInserted = new CountDownLatch(1);
    CountDownLatch commitWinner = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      // The winner inserts but does not commit yet; the loser's pre-check misses the uncommitted
      // row and its insert waits on the winner's unique-index entry, then hits the conflict.
      Future<?> winner =
          pool.submit(
              () ->
                  new TransactionTemplate(transactionManager)
                      .executeWithoutResult(
                          status -> {
                            chatService.send(rider.userId(), request);
                            winnerInserted.countDown();
                            try {
                              commitWinner.await(10, TimeUnit.SECONDS);
                            } catch (InterruptedException ex) {
                              Thread.currentThread().interrupt();
                            }
                          }));
      assertThat(winnerInserted.await(10, TimeUnit.SECONDS)).isTrue();
      Future<ChatMessageDto> loser = pool.submit(() -> chatService.send(rider.userId(), request));
      assertThat(awaitLockWait()).isTrue();
      commitWinner.countDown();
      winner.get(10, TimeUnit.SECONDS);
      ChatMessageDto deduplicated = loser.get(10, TimeUnit.SECONDS);
      assertThat(deduplicated.clientMsgId()).isEqualTo(request.clientMsgId());
    } finally {
      pool.shutdownNow();
    }

    assertThat(messageRows(rideId)).isEqualTo(1);
    // One push and one frame to the recipient — the loser only echoes to the sender.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ? AND event ="
                    + " 'chat.message'",
                Integer.class,
                driver.userId()))
        .isEqualTo(1);
    assertThat(next(driverSocket.frames(), "chat.message").get("body").asText())
        .isEqualTo("at the gate");
    assertThatThrownBy(() -> next(driverSocket.frames(), "chat.message", 1000))
        .isInstanceOf(AssertionError.class);
  }

  /** Whether another backend connection is waiting on a row/transaction lock (within 10 s). */
  private boolean awaitLockWait() throws InterruptedException {
    long deadline = System.currentTimeMillis() + 10_000;
    while (System.currentTimeMillis() < deadline) {
      Integer waiting =
          jdbcTemplate.queryForObject(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'"
                  + " AND datname = current_database()",
              Integer.class);
      if (waiting != null && waiting > 0) {
        return true;
      }
      Thread.sleep(20);
    }
    return false;
  }

  @Test
  @DisplayName("UC-S-13 E1: a resend with the same clientMsgId returns the stored message, one row")
  void shouldDeduplicateResends() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    Socket first = connect(rider);
    UUID clientMsgId = UUID.randomUUID();
    sendFrame(first, textSend(rideId, clientMsgId, "are you close?"));
    String messageId = next(first.frames(), "chat.message").get("messageId").asText();

    // The reconnect resend: same clientMsgId, new socket — same stored message, no duplicate.
    Socket second = connect(rider);
    sendFrame(second, textSend(rideId, clientMsgId, "are you close?"));
    JsonNode echo = next(second.frames(), "chat.message");
    assertThat(echo.get("messageId").asText()).isEqualTo(messageId);
    assertThat(echo.get("clientMsgId").asText()).isEqualTo(clientMsgId.toString());
    assertThat(messageRows(rideId)).isEqualTo(1);

    // The `after` backfill pairs with the dedup for lossless reconnection.
    advance(Duration.ofSeconds(1));
    Socket driverSocket = connect(driver);
    sendFrame(driverSocket, textSend(rideId, UUID.randomUUID(), "two minutes"));
    next(driverSocket.frames(), "chat.message");
    JsonNode backfill =
        ok(
            get("/api/v1/rides/" + rideId + "/chat/messages?after=" + messageId, rider.token()),
            HttpStatus.OK);
    assertThat(backfill.get("items")).hasSize(1);
    assertThat(backfill.get("items").get(0).get("body").asText()).isEqualTo("two minutes");
    // At most one of before/after.
    assertThat(
            get(
                    "/api/v1/rides/" + rideId + "/chat/messages?after=" + messageId + "&before=x",
                    rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  // ---- read state ------------------------------------------------------------------------------

  @Test
  @DisplayName("CHAT-02: read markers over the WS frame and the REST fallback; unread counts")
  void shouldRecordReadMarkersOverBothTransports() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    Socket riderSocket = connect(rider);
    Socket driverSocket = connect(driver);
    String firstId = sendOverSocket(riderSocket, rideId, "first").get("messageId").asText();
    advance(Duration.ofSeconds(1));
    String secondId = sendOverSocket(riderSocket, rideId, "second").get("messageId").asText();

    assertThat(ok(thread(driver, rideId), HttpStatus.OK).get("unreadCount").asInt()).isEqualTo(2);
    assertThat(ok(thread(rider, rideId), HttpStatus.OK).get("unreadCount").asInt()).isZero();

    // WS frame: marker stored, counterpart notified.
    Map<String, Object> read = new LinkedHashMap<>();
    read.put("type", "chat.read");
    read.put("rideId", rideId.toString());
    read.put("lastReadMessageId", firstId);
    sendFrame(driverSocket, read);
    JsonNode relayed = next(riderSocket.frames(), "chat.read");
    assertThat(relayed.get("readerRole").asText()).isEqualTo("driver");
    assertThat(relayed.get("lastReadMessageId").asText()).isEqualTo(firstId);
    JsonNode afterFirst = ok(thread(driver, rideId), HttpStatus.OK);
    assertThat(afterFirst.get("unreadCount").asInt()).isEqualTo(1);
    assertThat(afterFirst.get("lastReadMessageId").asText()).isEqualTo(firstId);
    assertThat(
            ok(thread(rider, rideId), HttpStatus.OK).get("counterpartLastReadMessageId").asText())
        .isEqualTo(firstId);

    // REST fallback: advances the marker; an older id is ignored (idempotent).
    ok(
        post(
            "/api/v1/rides/" + rideId + "/chat/read",
            Map.of("lastReadMessageId", secondId),
            driver.token()),
        HttpStatus.NO_CONTENT);
    assertThat(ok(thread(driver, rideId), HttpStatus.OK).get("unreadCount").asInt()).isZero();
    ok(
        post(
            "/api/v1/rides/" + rideId + "/chat/read",
            Map.of("lastReadMessageId", firstId),
            driver.token()),
        HttpStatus.NO_CONTENT);
    assertThat(ok(thread(driver, rideId), HttpStatus.OK).get("lastReadMessageId").asText())
        .isEqualTo(secondId);
    // A message of another chat is 404.
    assertThat(
            post(
                    "/api/v1/rides/" + rideId + "/chat/read",
                    Map.of("lastReadMessageId", UUID.randomUUID().toString()),
                    driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  // ---- quick replies ---------------------------------------------------------------------------

  @Test
  @DisplayName("CHAT-02: the catalog filters by audience; unknown/inactive codes are refused")
  void shouldServeQuickRepliesPerAudience() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);

    JsonNode riderCatalog =
        ok(get("/api/v1/chat/quick-replies?as=rider", rider.token()), HttpStatus.OK);
    List<String> riderCodes = new ArrayList<>();
    riderCatalog.forEach(entry -> riderCodes.add(entry.get("code").asText()));
    assertThat(riderCodes)
        .contains("rider_coming", "both_okay", "both_thanks")
        .doesNotContain("driver_on_my_way");
    assertThat(riderCatalog.get(0).get("textEn").asText()).isNotBlank();
    assertThat(riderCatalog.get(0).get("textAr").asText()).isNotBlank();

    // The driver app asks as=driver: driver + both only, even though the driver account also
    // holds the rider role (registration grants it) — owner ruling 2026-10-15 (M10 review B-H2).
    JsonNode driverCatalog =
        ok(get("/api/v1/chat/quick-replies?as=driver", driver.token()), HttpStatus.OK);
    List<String> driverCodes = new ArrayList<>();
    driverCatalog.forEach(entry -> driverCodes.add(entry.get("code").asText()));
    assertThat(driverCodes)
        .contains("driver_on_my_way", "both_okay")
        .noneMatch(code -> code.startsWith("rider_"));
    assertThat(riderCodes).noneMatch(code -> code.startsWith("driver_"));

    // Unknown and inactive codes are invalid_message; nothing is stored.
    Socket riderSocket = connect(rider);
    Map<String, Object> unknown = new LinkedHashMap<>();
    unknown.put("type", "chat.send");
    unknown.put("rideId", rideId.toString());
    unknown.put("clientMsgId", UUID.randomUUID().toString());
    unknown.put("kind", "quick_reply");
    unknown.put("quickReplyCode", "no_such_code");
    sendFrame(riderSocket, unknown);
    assertThat(next(riderSocket.frames(), "error").get("code").asText())
        .isEqualTo("invalid_message");
    jdbcTemplate.update("UPDATE chat_quick_replies SET active = false WHERE code = 'both_okay'");
    try {
      assertThat(
              ok(get("/api/v1/chat/quick-replies?as=rider", rider.token()), HttpStatus.OK)
                  .findValues("code"))
          .noneMatch(code -> code.asText().equals("both_okay"));
      unknown.put("clientMsgId", UUID.randomUUID().toString());
      unknown.put("quickReplyCode", "both_okay");
      sendFrame(riderSocket, unknown);
      assertThat(next(riderSocket.frames(), "error").get("code").asText())
          .isEqualTo("invalid_message");
    } finally {
      jdbcTemplate.update("UPDATE chat_quick_replies SET active = true WHERE code = 'both_okay'");
    }
    // Shape errors are invalid_message too (a text needs a body).
    Map<String, Object> empty = textSend(rideId, UUID.randomUUID(), " ");
    sendFrame(riderSocket, empty);
    assertThat(next(riderSocket.frames(), "error").get("code").asText())
        .isEqualTo("invalid_message");
    assertThat(messageRows(rideId)).isZero();
  }

  @Test
  @DisplayName("CHAT-02: the catalog needs as=rider|driver (400) and that role (403)")
  void shouldRequireTheAskingSideForQuickReplies() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);

    assertThat(get("/api/v1/chat/quick-replies", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/chat/quick-replies?as=both", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(get("/api/v1/chat/quick-replies?as=admin", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    // A rider-only account is no driver.
    assertThat(get("/api/v1/chat/quick-replies?as=driver", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    // The driver account holds the rider role too, so it may ask as a rider.
    assertThat(get("/api/v1/chat/quick-replies?as=rider", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("CHAT-02: a party cannot send the other side's quick-reply codes (invalid_message)")
  void shouldRefuseCrossAudienceQuickReplies() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);

    Socket driverSocket = connect(driver);
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.send");
    frame.put("rideId", rideId.toString());
    frame.put("clientMsgId", UUID.randomUUID().toString());
    frame.put("kind", "quick_reply");
    frame.put("quickReplyCode", "rider_coming");
    sendFrame(driverSocket, frame);
    assertThat(next(driverSocket.frames(), "error").get("code").asText())
        .isEqualTo("invalid_message");

    Socket riderSocket = connect(rider);
    frame.put("clientMsgId", UUID.randomUUID().toString());
    frame.put("quickReplyCode", "driver_on_my_way");
    sendFrame(riderSocket, frame);
    assertThat(next(riderSocket.frames(), "error").get("code").asText())
        .isEqualTo("invalid_message");
    assertThat(messageRows(rideId)).isZero();

    // Own-side and shared codes still go through.
    frame.put("clientMsgId", UUID.randomUUID().toString());
    frame.put("quickReplyCode", "both_okay");
    sendFrame(riderSocket, frame);
    assertThat(next(riderSocket.frames(), "chat.message").get("quickReplyCode").asText())
        .isEqualTo("both_okay");
    assertThat(messageRows(rideId)).isEqualTo(1);
  }

  // ---- admin log (CHAT-03) ---------------------------------------------------------------------

  @Test
  @DisplayName("CHAT-03: support:view reads the full log (audited); others are 403")
  void shouldServeAdminChatLog() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    Socket riderSocket = connect(rider);
    sendOverSocket(riderSocket, rideId, "support will read this");

    String support = registerAdmin("+963937901001", RbacIds.SUPPORT_ROLE_ID);
    JsonNode log = ok(get("/api/v1/admin/rides/" + rideId + "/chat", support), HttpStatus.OK);
    assertThat(log.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(log.get("windowState").asText()).isEqualTo("open");
    assertThat(log.get("items")).hasSize(1);
    assertThat(log.get("items").get(0).get("body").asText()).isEqualTo("support will read this");
    assertThat(log.get("items").get(0).has("clientMsgId")).isFalse();
    assertThat(auditActions(rideId.toString())).contains("chat.view");

    // An admin without support:view is refused; so are the parties.
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('No support', false) RETURNING role_id",
            UUID.class);
    String powerless = registerAdmin("+963937901002", roleId);
    assertThat(get("/api/v1/admin/rides/" + rideId + "/chat", powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/rides/" + rideId + "/chat", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/rides/" + UUID.randomUUID() + "/chat", support).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("history pages backwards on a stable cursor, oldest first within each page")
  void shouldPageHistoryBackwards() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    Socket riderSocket = connect(rider);
    for (int i = 1; i <= 5; i++) {
      advance(Duration.ofSeconds(1));
      sendOverSocket(riderSocket, rideId, "m" + i);
    }

    JsonNode newest =
        ok(get("/api/v1/rides/" + rideId + "/chat/messages?size=2", rider.token()), HttpStatus.OK);
    assertThat(newest.get("items").get(0).get("body").asText()).isEqualTo("m4");
    assertThat(newest.get("items").get(1).get("body").asText()).isEqualTo("m5");
    JsonNode middle =
        ok(
            get(
                "/api/v1/rides/"
                    + rideId
                    + "/chat/messages?size=2&before="
                    + newest.get("nextCursor").asText(),
                rider.token()),
            HttpStatus.OK);
    assertThat(middle.get("items").get(0).get("body").asText()).isEqualTo("m2");
    assertThat(middle.get("items").get(1).get("body").asText()).isEqualTo("m3");
    JsonNode oldest =
        ok(
            get(
                "/api/v1/rides/"
                    + rideId
                    + "/chat/messages?size=2&before="
                    + middle.get("nextCursor").asText(),
                rider.token()),
            HttpStatus.OK);
    assertThat(oldest.get("items")).hasSize(1);
    assertThat(oldest.get("items").get(0).get("body").asText()).isEqualTo("m1");
    assertThat(oldest.get("nextCursor").isNull()).isTrue();
  }
}
