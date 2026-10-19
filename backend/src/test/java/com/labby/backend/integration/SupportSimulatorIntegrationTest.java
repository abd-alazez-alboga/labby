package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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
 * M14-T5 acceptance — the support walkthrough, scripted on a controlled clock through the real HTTP
 * API and the calls the T3/T4 screens make: notifications go through the real outbox dispatcher to
 * the notification center of the right app and a captured push; the ride chat runs over the real
 * socket. Three scenarios: (1) help center first → a ticket with a ride link and a photo → support
 * replies → {@code waiting_on_user} with its 48 h reminder → the user's reply → resolved → closed,
 * notified at every step, plus the wallet-credit remedy traceable by the ticket ref and a driver
 * ticket linked from the earnings list; (2) a lost item on a ride past the 24 h tail → the chat
 * reopens → the driver coordinates over the socket → {@code returned} → the chat closes with the
 * case, both parties notified on every change; (3) feedback from both apps across weeks, tagged and
 * counted in the admin trend window.
 */
class SupportSimulatorIntegrationTest extends AbstractSupportIntegrationTest {

  private static final long FRAME_WAIT_MS = 5000;

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private ObjectMapper objectMapper;
  @LocalServerPort private int port;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final List<WebSocket> sockets = new ArrayList<>();
  private final Map<String, List<PushMessage>> pushes = new HashMap<>();
  private int devices;

  @BeforeEach
  void capturePushes() {
    pushes.clear();
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> {
              for (Object token : invocation.<List<?>>getArgument(0)) {
                pushes
                    .computeIfAbsent((String) token, key -> new CopyOnWriteArrayList<>())
                    .add(invocation.getArgument(1));
              }
              return new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of());
            });
  }

  @AfterEach
  void closeSockets() {
    sockets.forEach(WebSocket::abort);
    sockets.clear();
  }

  // ---- 1. help -> ticket -> waiting_on_user -> resolved -> closed ------------------------------

  @Test
  @DisplayName(
      "SUP-01…04 / UC-S-19…21: help center first, then a ticket with a ride and a photo, worked by"
          + " support through waiting_on_user (48 h reminder) to closed — the center and a push"
          + " at every step; the wallet remedy traceable by the ticket ref; a driver ticket"
          + " linked from the earnings list")
  void shouldRunTheSupportLoopWithNotificationsThroughout() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID ride = completedApiRide(rider, driver);
    String riderDevice = device(rider, "rider");
    String driverDevice = device(driver, "driver");
    setLanguage(driver, "Driver Dana", "ar");
    UUID payments = category("Payments", "high");
    String handler = handler();

    // Admin authors the help content in both languages and publishes it.
    UUID helpCategory =
        UUID.fromString(
            ok(
                    post(
                        "/api/v1/admin/help/categories",
                        Map.of("nameEn", "Payments", "nameAr", "الدفع"),
                        admin),
                    HttpStatus.CREATED)
                .get("helpCategoryId")
                .asText());
    Map<String, Object> article = new HashMap<>();
    article.put("helpCategoryId", helpCategory.toString());
    article.put("titleEn", "My promo code did not apply");
    article.put("titleAr", "لم يُطبَّق رمز العرض");
    article.put("bodyEn", "Promo codes apply at booking. If yours did not, open a ticket.");
    article.put("bodyAr", "تُطبَّق رموز العرض عند الحجز. إن لم يُطبَّق رمزك فافتح تذكرة.");
    String articleId =
        ok(post("/api/v1/admin/help/articles", article, admin), HttpStatus.CREATED)
            .get("helpArticleId")
            .asText();
    ok(post("/api/v1/admin/help/articles/" + articleId + "/publish", null, admin), HttpStatus.OK);

    // The rider browses the help center first: category -> article, then a search.
    JsonNode categories = ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK);
    assertThat(categories.findValuesAsText("helpCategoryId")).contains(helpCategory.toString());
    JsonNode inCategory =
        ok(
            get("/api/v1/help/categories/" + helpCategory + "/articles", rider.token()),
            HttpStatus.OK);
    assertThat(inCategory.findValuesAsText("helpArticleId")).containsExactly(articleId);
    JsonNode read = ok(get("/api/v1/help/articles/" + articleId, rider.token()), HttpStatus.OK);
    assertThat(read.toString()).contains("open a ticket");
    JsonNode hits = ok(get("/api/v1/help/search?q=promo&lang=en", rider.token()), HttpStatus.OK);
    assertThat(hits.findValuesAsText("helpArticleId")).contains(articleId);
    JsonNode arHits = ok(get("/api/v1/help/search?q=العرض&lang=ar", driver.token()), HttpStatus.OK);
    assertThat(arHits.findValuesAsText("helpArticleId")).contains(articleId);

    // Not answered -> "create ticket": the pickable categories, a photo, the ride from history.
    JsonNode pickable = ok(get("/api/v1/support/ticket-categories", rider.token()), HttpStatus.OK);
    assertThat(pickable.findValuesAsText("ticketCategoryId")).contains(payments.toString());
    UUID photo = ticketFile(rider, "ticket_attachment");
    Map<String, Object> body = ticketBody(payments, "My promo code did not apply on this ride");
    body.put("rideId", ride.toString());
    body.put("attachmentFileIds", List.of(photo.toString()));
    JsonNode created = ok(post("/api/v1/tickets", body, rider.token()), HttpStatus.CREATED);
    String ticketId = created.get("ticketId").asText();
    assertThat(created.get("priority").asText()).as("category default").isEqualTo("high");
    assertThat(created.get("ride").get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(created.get("attachments")).hasSize(1);
    assertDelivered(rider, "rider", riderDevice, "support.ticket_created", ticketId, "ticket");

    // Support picks it up from the queue, replies, and asks the rider for more.
    JsonNode queue = ok(get("/api/v1/admin/tickets", handler), HttpStatus.OK);
    assertThat(queue.get("items").get(0).get("ticketId").asText()).isEqualTo(ticketId);
    ok(setStatus(handler, ticketId, "in_progress"), HttpStatus.OK);
    assertDelivered(
        rider, "rider", riderDevice, "support.ticket_status_changed", ticketId, "ticket");
    ok(adminReply(handler, ticketId, "Which code did you use?"), HttpStatus.CREATED);
    assertDelivered(rider, "rider", riderDevice, "support.ticket_message", ticketId, "ticket");
    assertThat(myTicket(rider, ticketId).get("unreadSupportMessages").asInt()).isEqualTo(1);
    ok(setStatus(handler, ticketId, "waiting_on_user"), HttpStatus.OK);
    assertDelivered(
        rider, "rider", riderDevice, "support.ticket_status_changed", ticketId, "ticket");
    assertThat(pushes.get(riderDevice).getLast().title()).isEqualTo("Support needs your reply");

    // 48 h without a reply: one reminder, in the center, the push and the thread history.
    advance(Duration.ofHours(48));
    assertThat(ticketReminderService.runReminderPass()).isEqualTo(1);
    assertDelivered(rider, "rider", riderDevice, "support.waiting_reminder", ticketId, "ticket");
    JsonNode thread = ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK);
    assertThat(thread.get("events").findValuesAsText("type")).contains("reminder_sent");
    assertThat(thread.get("messages").get(0).get("senderName").asText()).isEqualTo("Labby support");
    assertThat(myTicket(rider, ticketId).get("unreadSupportMessages").asInt())
        .as("read by opening the thread")
        .isZero();

    // The rider answers: back to in_progress implicitly; support remedies with a wallet credit.
    ok(userReply(rider, ticketId, "SUMMER10"), HttpStatus.CREATED);
    assertThat(ticketRow(ticketId).get("status")).isEqualTo("in_progress");
    notificationDispatchService.dispatchPending();
    assertThat(pushes.get(riderDevice).getLast().data())
        .as("T6 amendment j: no push for the rider's own move back to in_progress")
        .containsEntry("event", "support.waiting_reminder");
    String reason = "Support ticket T-" + ticketId.substring(0, 8).toUpperCase();
    ok(
        post(
            "/api/v1/admin/users/" + rider.userId() + "/wallet/credits",
            Map.of("type", "grant", "amount", "1.50", "currency", "SYP", "reason", reason),
            admin),
        HttpStatus.CREATED);
    JsonNode ledger =
        ok(
            get("/api/v1/admin/users/" + rider.userId() + "/wallet/transactions", admin),
            HttpStatus.OK);
    assertThat(ledger.get("items").findValuesAsText("reason"))
        .as("the credit is traceable to the ticket in the admin ledger")
        .contains(reason);
    ok(setStatus(handler, ticketId, "resolved"), HttpStatus.OK);
    ok(setStatus(handler, ticketId, "closed"), HttpStatus.OK);
    notificationDispatchService.dispatchPending();

    assertThat(statusNotifications(rider.userId()))
        .containsExactly("in_progress", "waiting_on_user", "resolved", "closed");
    assertThat(pushEvents(riderDevice))
        .containsSubsequence(
            "support.ticket_created",
            "support.ticket_status_changed",
            "support.ticket_message",
            "support.ticket_status_changed",
            "support.waiting_reminder",
            "support.ticket_status_changed",
            "support.ticket_status_changed");
    assertThat(pushes.get(riderDevice).getLast().title()).isEqualTo("Ticket closed");
    assertThat(code(userReply(rider, ticketId, "thanks"))).isEqualTo("ticket_closed");
    assertThat(myTicket(rider, ticketId).get("status").asText()).isEqualTo("closed");
    assertThat(auditActions(ticketId)).contains("ticket.status", "ticket.reply");

    // The driver opens a ticket too, the ride picked from the earnings list (T3: no driver ride
    // history API) — the push arrives in Arabic on the driver app.
    JsonNode earnings = ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK);
    UUID earnedRide = UUID.fromString(earnings.get("items").get(0).get("rideId").asText());
    assertThat(earnedRide).isEqualTo(ride);
    Map<String, Object> driverBody = ticketBody(payments, "Rider paid less than the fare");
    driverBody.put("rideId", earnedRide.toString());
    driverBody.put("submittedAs", "driver");
    String driverTicket =
        ok(post("/api/v1/tickets", driverBody, driver.token()), HttpStatus.CREATED)
            .get("ticketId")
            .asText();
    assertDelivered(
        driver, "driver", driverDevice, "support.ticket_created", driverTicket, "ticket");
    assertThat(pushes.get(driverDevice).getLast().title()).containsPattern("[\\u0600-\\u06FF]");
    assertThat(pushes.getOrDefault(riderDevice, List.of()))
        .as("the rider is never told about the driver's ticket")
        .noneMatch(push -> driverTicket.equals(ticketIdOf(push)));
    // T5 ruling: the side admins see is the sending app's, with or without a ride.
    Map<String, Object> noRide = ticketBody(payments, "How do I change my payout day?");
    noRide.put("submittedAs", "driver");
    String noRideTicket =
        ok(post("/api/v1/tickets", noRide, driver.token()), HttpStatus.CREATED)
            .get("ticketId")
            .asText();
    for (String id : List.of(driverTicket, noRideTicket)) {
      assertThat(
              ok(get("/api/v1/admin/tickets/" + id, handler), HttpStatus.OK)
                  .get("user")
                  .get("role")
                  .asText())
          .isEqualTo("driver");
    }
    assertThat(
            ok(get("/api/v1/admin/tickets/" + ticketId, handler), HttpStatus.OK)
                .get("user")
                .get("role")
                .asText())
        .isEqualTo("rider");
  }

  // ---- 2. lost item -> chat reopens -> driver coordinates -> returned -> chat closes -----------

  @Test
  @DisplayName(
      "LOST-01/02 / UC-R-20, UC-D-21: a lost item on a ride past the 24 h tail reopens the chat;"
          + " the driver coordinates over the socket; returned keeps it open, closure closes it;"
          + " both parties notified on every case change")
  void shouldTrackTheChatWithTheLostItemCase() throws Exception {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID ride = completedApiRide(rider, driver);
    String riderDevice = device(rider, "rider");
    String driverDevice = device(driver, "driver");
    String handler = handler();
    advance(Duration.ofHours(30));
    assertThat(chatWindow(rider, ride)).isEqualTo("read_only");
    Socket early = connect(rider);
    sendFrame(early, textSend(ride, "Hello?"));
    assertThat(next(early, "error").get("code").asText()).isEqualTo("chat_closed");

    // The rider reports from ride history with a photo: the case opens, the chat reopens.
    UUID photo = ticketFile(rider, "lost_item_photo");
    Map<String, Object> report = new HashMap<>();
    report.put("description", "Black wallet, back seat");
    report.put("photoFileIds", List.of(photo.toString()));
    JsonNode opened =
        ok(post("/api/v1/rides/" + ride + "/lost-item", report, rider.token()), HttpStatus.CREATED);
    String ticketId = opened.get("ticketId").asText();
    assertThat(opened.get("caseStatus").asText()).isEqualTo("reported");
    assertThat(opened.get("chatWindow").asText()).isEqualTo("reopened");
    assertDelivered(rider, "rider", riderDevice, "support.ticket_created", ticketId, "ticket");
    assertDelivered(
        driver, "driver", driverDevice, "lost_item.case_opened", ticketId, "lost_item_case");

    // The driver's support list merges GET /tickets with GET /lost-items (T3): the case shows
    // through the lost-items read only, never as the driver's own ticket.
    JsonNode driverCases = ok(get("/api/v1/lost-items?open=true", driver.token()), HttpStatus.OK);
    assertThat(driverCases.get("items").findValuesAsText("ticketId")).containsExactly(ticketId);
    assertThat(
            ok(get("/api/v1/tickets", driver.token()), HttpStatus.OK)
                .get("items")
                .findValuesAsText("ticketId"))
        .doesNotContain(ticketId);
    JsonNode driverCase = ok(get("/api/v1/lost-items/" + ticketId, driver.token()), HttpStatus.OK);
    assertThat(driverCase.get("chatWindow").asText()).isEqualTo("reopened");
    // The Call button's number comes from the chat thread (the case payload has no phone).
    JsonNode chat = ok(get("/api/v1/rides/" + ride + "/chat", driver.token()), HttpStatus.OK);
    assertThat(chat.get("windowState").asText()).isEqualTo("reopened");
    assertThat(chat.get("counterpart").get("phone").asText()).isEqualTo(rider.phone());

    // The driver coordinates with the rider over the reopened chat.
    Socket riderSocket = connect(rider);
    Socket driverSocket = connect(driver);
    sendFrame(riderSocket, textSend(ride, "Did you find a black wallet?"));
    next(riderSocket, "chat.message"); // the sender's own echo
    assertThat(next(driverSocket, "chat.message").get("body").asText())
        .isEqualTo("Did you find a black wallet?");
    ok(setCaseStatus(handler, ticketId, "driver_contacted"), HttpStatus.OK);
    sendFrame(driverSocket, textSend(ride, "Yes, I have it. Pharmacy corner at 6?"));
    next(driverSocket, "chat.message"); // the sender's own echo
    assertThat(next(riderSocket, "chat.message").get("body").asText())
        .isEqualTo("Yes, I have it. Pharmacy corner at 6?");
    ok(setCaseStatus(handler, ticketId, "found"), HttpStatus.OK);
    JsonNode returned = ok(setCaseStatus(handler, ticketId, "returned"), HttpStatus.OK);
    assertThat(returned.get("status").asText()).isEqualTo("resolved");
    assertThat(chatWindow(driver, ride)).as("open until the case closes").isEqualTo("reopened");
    sendFrame(riderSocket, textSend(ride, "Got it, thank you!"));
    next(riderSocket, "chat.message"); // the sender's own echo
    assertThat(next(driverSocket, "chat.message").get("body").asText())
        .isEqualTo("Got it, thank you!");

    // Closure: the chat goes read-only again with the case.
    ok(setCaseStatus(handler, ticketId, "closed"), HttpStatus.OK);
    assertThat(chatWindow(rider, ride)).isEqualTo("read_only");
    assertThat(chatWindow(driver, ride)).isEqualTo("read_only");
    sendFrame(driverSocket, textSend(ride, "One more thing"));
    assertThat(next(driverSocket, "error").get("code").asText()).isEqualTo("chat_closed");
    assertThat(
            ok(get("/api/v1/lost-items?open=true", driver.token()), HttpStatus.OK)
                .get("items")
                .size())
        .isZero();

    // Both parties were told every case change, each on their own app and deep link.
    notificationDispatchService.dispatchPending();
    List<String> expected = List.of("driver_contacted", "found", "returned", "closed");
    for (Account party : List.of(rider, driver)) {
      assertThat(outboxParams(party.userId(), "lost_item.case_status_changed"))
          .map(params -> params.replaceAll(".*\"caseStatus\"\\s*:\\s*\"([a-z_]+)\".*", "$1"))
          .containsExactlyElementsOf(expected);
    }
    assertThat(casePushes(riderDevice, ticketId)).hasSize(4);
    assertThat(casePushes(driverDevice, ticketId)).hasSize(4);
    assertThat(casePushes(riderDevice, ticketId).get(1).body()).contains("your item was found");
    assertThat(centerEvents(rider, "rider"))
        .filteredOn("lost_item.case_status_changed"::equals)
        .hasSize(4);
    assertThat(centerEvents(driver, "driver"))
        .filteredOn("lost_item.case_status_changed"::equals)
        .hasSize(4);
    assertThat(pushes.get(driverDevice))
        .filteredOn(push -> "lost_item.case_status_changed".equals(push.data().get("event")))
        .allSatisfy(push -> assertThat(push.data()).containsEntry("screen", "lost_item_case"));
    assertThat(pushes.get(driverDevice))
        .as("the driver never gets the rider's ticket-status pushes")
        .noneMatch(push -> "support.ticket_status_changed".equals(push.data().get("event")));
    assertThat(history(ticketId))
        .contains(
            "case_status_changed/support:found>returned",
            "status_changed/support:in_progress>resolved",
            "status_changed/support:resolved>closed");
  }

  // ---- 3. feedback -> admin trends ------------------------------------------------------------

  @Test
  @DisplayName(
      "FDBK-01 / UC-S-22, UC-A-25: feedback from both apps across weeks, tagged by support and"
          + " counted in the admin's 4-week trend window")
  void shouldShowFeedbackInTheAdminTrends() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String handler = handler();
    // Two whole weeks back, a Wednesday at noon UTC.
    Instant monday =
        CLOCK
            .instant()
            .atZone(ZoneOffset.UTC)
            .with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY))
            .truncatedTo(ChronoUnit.DAYS)
            .toInstant();
    CLOCK.set(monday.plus(Duration.ofDays(2)).plus(Duration.ofHours(12)));
    String surge = feedback(rider, "pricing", "Surge is too high in the evening", "rider");
    advance(Duration.ofDays(7));
    feedback(driver, "pricing", "Fares are too low for long trips", "driver");
    feedback(rider, "app_experience", "Love the live map", "rider");
    advance(Duration.ofDays(7));
    feedback(rider, "safety", "Please add a share-trip reminder", "rider");

    ok(
        put(
            "/api/v1/admin/feedback/" + surge + "/tags",
            Map.of("tags", List.of("surge", "evening")),
            handler),
        HttpStatus.OK);
    JsonNode tagged = ok(get("/api/v1/admin/feedback?tag=surge", handler), HttpStatus.OK);
    assertThat(tagged.get("items").findValuesAsText("feedbackId")).containsExactly(surge);

    // The admin trend: from the Monday 3 weeks back to the next Monday, weekly buckets (T4).
    Instant thisMonday = monday.plus(Duration.ofDays(14));
    Instant from = thisMonday.minus(Duration.ofDays(21));
    Instant to = thisMonday.plus(Duration.ofDays(7));
    JsonNode trend =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from=" + from + "&to=" + to + "&bucket=week",
                handler),
            HttpStatus.OK);
    assertThat(trend.get("total").asInt()).isEqualTo(4);
    assertThat(trend.get("byCategory").get("pricing").asInt()).isEqualTo(2);
    JsonNode buckets = trend.get("buckets");
    assertThat(buckets).hasSize(4);
    assertThat(buckets.get(0).get("total").asInt()).as("no entries 3 weeks back").isZero();
    assertThat(buckets.get(1).get("byCategory").get("pricing").asInt()).isEqualTo(1);
    assertThat(buckets.get(2).get("total").asInt()).isEqualTo(2);
    assertThat(buckets.get(3).get("byCategory").get("safety").asInt()).isEqualTo(1);
    JsonNode driversOnly =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from="
                    + from
                    + "&to="
                    + to
                    + "&bucket=week&submittedAs=driver",
                handler),
            HttpStatus.OK);
    assertThat(driversOnly.get("total").asInt()).isEqualTo(1);
    assertThat(driversOnly.get("buckets").get(2).get("byCategory").get("pricing").asInt())
        .isEqualTo(1);
  }

  // ---- helpers --------------------------------------------------------------------------------

  /** Registers a push device for the account on its app; returns the device token. */
  private String device(Account account, String app) {
    String token = "fcm-support-" + (++devices);
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
    return token;
  }

  private void setLanguage(Account account, String name, String language) {
    ok(
        put("/api/v1/users/me", Map.of("name", name, "language", language), account.token()),
        HttpStatus.OK);
  }

  /**
   * Dispatches the outbox, then asserts the newest center entry of the app and the newest push to
   * the device are this event, deep-linked to the ticket.
   */
  private void assertDelivered(
      Account account, String app, String device, String event, String ticketId, String screen) {
    notificationDispatchService.dispatchPending();
    JsonNode newest =
        ok(get("/api/v1/notifications?app=" + app, account.token()), HttpStatus.OK)
            .get("items")
            .get(0);
    assertThat(newest.get("event").asText()).isEqualTo(event);
    assertThat(newest.get("read").asBoolean()).isFalse();
    assertThat(newest.get("title").asText()).isNotBlank();
    assertThat(newest.toString()).contains(ticketId);
    assertThat(pushes.get(device)).as("push to %s", device).isNotEmpty();
    PushMessage push = pushes.get(device).getLast();
    assertThat(push.data()).containsEntry("event", event).containsEntry("screen", screen);
    assertThat(ticketIdOf(push)).isEqualTo(ticketId);
  }

  private String ticketIdOf(PushMessage push) {
    try {
      String params = push.data().get("params");
      return params == null ? null : objectMapper.readTree(params).path("ticketId").asText(null);
    } catch (Exception ex) {
      throw new IllegalStateException(ex);
    }
  }

  private List<String> pushEvents(String device) {
    return pushes.getOrDefault(device, List.of()).stream()
        .map(push -> push.data().get("event"))
        .toList();
  }

  private List<PushMessage> casePushes(String device, String ticketId) {
    return pushes.getOrDefault(device, List.of()).stream()
        .filter(push -> "lost_item.case_status_changed".equals(push.data().get("event")))
        .filter(push -> ticketId.equals(ticketIdOf(push)))
        .toList();
  }

  private List<String> centerEvents(Account account, String app) {
    return ok(get("/api/v1/notifications?app=" + app + "&size=50", account.token()), HttpStatus.OK)
        .get("items")
        .findValuesAsText("event");
  }

  private JsonNode myTicket(Account account, String ticketId) {
    for (JsonNode item : ok(get("/api/v1/tickets", account.token()), HttpStatus.OK).get("items")) {
      if (ticketId.equals(item.get("ticketId").asText())) {
        return item;
      }
    }
    throw new AssertionError("ticket " + ticketId + " not in the user's list");
  }

  private String feedback(Account account, String category, String body, String as) {
    return ok(
            post(
                "/api/v1/feedback",
                Map.of("category", category, "body", body, "submittedAs", as),
                account.token()),
            HttpStatus.CREATED)
        .get("feedbackId")
        .asText();
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

  private static Map<String, Object> textSend(UUID rideId, String body) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.send");
    frame.put("rideId", rideId.toString());
    frame.put("clientMsgId", UUID.randomUUID().toString());
    frame.put("kind", "text");
    frame.put("body", body);
    return frame;
  }
}
