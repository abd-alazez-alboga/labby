package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M14-T2 tickets (SUP-01..03, UC-S-19/20, UC-A-21) through the API: uploads, creation under the
 * category and attachment rules, the FULL lifecycle with its history and notifications — including
 * the 48 h waiting_on_user reminder surfacing once per stay — reply-reopen until closed, the queue
 * sorted priority then age with its filters, priority override and assignment, contact access on
 * the admin detail, and the SOS-linked ticket (ruling 9).
 */
class SupportTicketsIntegrationTest extends AbstractSupportIntegrationTest {

  @Test
  @DisplayName("SUP-01: ticket uploads are private files of their own kinds")
  void shouldUploadTicketFiles() {
    Account rider = newRider();
    JsonNode pdf =
        ok(uploadTicketFile(rider.token(), "ticket_attachment", PDF), HttpStatus.CREATED);
    assertThat(pdf.get("kind").asText()).isEqualTo("ticket_attachment");
    assertThat(pdf.get("contentType").asText()).isEqualTo("application/pdf");
    assertThat(uploadTicketFile(rider.token(), "ticket_attachment", JPEG).getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(uploadTicketFile(rider.token(), "lost_item_photo", PNG).getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(uploadTicketFile(rider.token(), "lost_item_photo", PDF).getStatusCode())
        .as("a PDF is no lost-item photo")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadTicketFile(rider.token(), "document", PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadTicketFile(rider.token(), null, PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadTicketFile(rider.token(), "ticket_attachment", null).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    // The driver-files endpoint never mints ticket files.
    assertThat(uploadRaw(rider.token(), "ticket_attachment", PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "SUP-01/03: a ticket is born open with its category's default priority, from a pickable"
          + " category, with up to 5 own unused attachments and a ride the caller was party to")
  void shouldOpenTicketsUnderTheRules() {
    Account rider = newRider();
    Account driver = newDriver();
    Account stranger = newRider();
    UUID billing = category("Billing", "high");
    UUID retired = category("Retired", "low");
    ok(
        restTemplate.exchange(
            "/api/v1/admin/ticket-categories/" + retired,
            org.springframework.http.HttpMethod.PATCH,
            authorized(Map.of("active", false), admin),
            JsonNode.class),
        HttpStatus.OK);
    UUID ride = completedRide(rider.userId(), driver.userId(), CLOCK.instant());

    // The pickable list: active, never the system row, in order.
    JsonNode pickable = ok(get("/api/v1/support/ticket-categories", rider.token()), HttpStatus.OK);
    List<String> ids = new ArrayList<>();
    pickable.forEach(node -> ids.add(node.get("ticketCategoryId").asText()));
    assertThat(ids)
        .contains(billing.toString())
        .doesNotContain(retired.toString(), LOST_ITEM_CATEGORY);
    assertThat(pickable.get(0).get("name").has("ar")).isTrue();

    ResponseEntity<JsonNode> reserved =
        post(
            "/api/v1/tickets", ticketBody(UUID.fromString(LOST_ITEM_CATEGORY), "x"), rider.token());
    assertThat(reserved.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(reserved)).isEqualTo("category_reserved");
    ResponseEntity<JsonNode> inactive =
        post("/api/v1/tickets", ticketBody(retired, "x"), rider.token());
    assertThat(inactive.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(inactive)).isEqualTo("category_inactive");
    assertThat(
            post("/api/v1/tickets", ticketBody(UUID.randomUUID(), "x"), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    Map<String, Object> noSide = ticketBody(billing, "x");
    noSide.remove("submittedAs");
    assertThat(post("/api/v1/tickets", noSide, rider.token()).getStatusCode())
        .as("T5 ruling: submittedAs is required")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Map<String, Object> notADriver = ticketBody(billing, "x");
    notADriver.put("submittedAs", "driver");
    assertThat(post("/api/v1/tickets", notADriver, rider.token()).getStatusCode())
        .as("T5 ruling: the caller must hold the submittedAs role")
        .isEqualTo(HttpStatus.FORBIDDEN);
    Map<String, Object> blank = ticketBody(billing, "   ");
    assertThat(post("/api/v1/tickets", blank, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Map<String, Object> notParty = ticketBody(billing, "about a ride");
    notParty.put("rideId", ride.toString());
    assertThat(post("/api/v1/tickets", notParty, stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    Map<String, Object> unknownRide = ticketBody(billing, "about a ride");
    unknownRide.put("rideId", UUID.randomUUID().toString());
    assertThat(post("/api/v1/tickets", unknownRide, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    UUID own = ticketFile(rider, "ticket_attachment");
    Map<String, Object> tooMany = ticketBody(billing, "x");
    List<String> six = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      six.add(ticketFile(rider, "ticket_attachment").toString());
    }
    tooMany.put("attachmentFileIds", six);
    assertThat(post("/api/v1/tickets", tooMany, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Map<String, Object> foreign = ticketBody(billing, "x");
    foreign.put("attachmentFileIds", List.of(ticketFile(stranger, "ticket_attachment").toString()));
    assertThat(post("/api/v1/tickets", foreign, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Map<String, Object> wrongKind = ticketBody(billing, "x");
    wrongKind.put("attachmentFileIds", List.of(ticketFile(rider, "lost_item_photo").toString()));
    assertThat(post("/api/v1/tickets", wrongKind, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    Map<String, Object> twice = ticketBody(billing, "x");
    twice.put("attachmentFileIds", List.of(own.toString(), own.toString()));
    assertThat(post("/api/v1/tickets", twice, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    Map<String, Object> body = ticketBody(billing, "I was charged twice");
    body.put("rideId", ride.toString());
    body.put("attachmentFileIds", List.of(own.toString()));
    JsonNode ticket = ok(post("/api/v1/tickets", body, rider.token()), HttpStatus.CREATED);
    String ticketId = ticket.get("ticketId").asText();
    assertThat(ticket.get("kind").asText()).isEqualTo("ticket");
    assertThat(ticket.get("status").asText()).isEqualTo("open");
    assertThat(ticket.get("priority").asText()).as("the category's default").isEqualTo("high");
    assertThat(ticket.get("caseStatus").isNull()).isTrue();
    assertThat(ticket.get("category").get("name").get("en").asText()).isEqualTo("Billing");
    assertThat(ticket.get("ride").get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(ticket.get("ride").get("counterpartName").asText()).isEqualTo("Driver");
    assertThat(ticket.get("attachments")).hasSize(1);
    assertThat(ticket.get("attachments").get(0).get("url").asText()).startsWith("/api/v1/files/");
    assertThat(ticket.get("unreadSupportMessages").asInt()).isZero();
    assertThat(ticket.get("lastMessageAt").isNull()).isTrue();
    assertThat(outboxEvents(rider.userId())).contains("support.ticket_created");
    assertThat(history(ticketId)).containsExactly("created/user");
    // A file belongs to one ticket only.
    Map<String, Object> reuse = ticketBody(billing, "y");
    reuse.put("attachmentFileIds", List.of(own.toString()));
    assertThat(post("/api/v1/tickets", reuse, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    // Mine: both kinds, most recently updated first; a stranger never sees it.
    JsonNode mine = ok(get("/api/v1/tickets", rider.token()), HttpStatus.OK);
    assertThat(mine.get("totalItems").asInt()).isEqualTo(1);
    assertThat(
            ok(get("/api/v1/tickets?status=closed", rider.token()), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isZero();
    assertThat(get("/api/v1/tickets/" + ticketId, stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    JsonNode detail = ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK);
    assertThat(detail.get("messages")).isEmpty();
    assertThat(detail.get("events")).hasSize(1);
    assertThat(detail.get("events").get(0).get("type").asText()).isEqualTo("created");
    assertThat(ticketRow(ticketId).get("user_read_at")).as("V27 read marker").isNotNull();
  }

  @Test
  @DisplayName(
      "SUP-02: the full lifecycle — admin transitions and their 409s, implicit moves on replies,"
          + " one 48 h reminder per waiting_on_user stay, every status change notified and in the"
          + " history, closed read-only")
  void shouldRunTheFullLifecycle() {
    Account rider = newRider();
    UUID general = category("General", "normal");
    String handler = handler();
    String viewer = viewer();
    String ticketId =
        openTicket(rider, general, "My promo code did not apply").get("ticketId").asText();

    // Viewers read, never write.
    assertThat(setStatus(viewer, ticketId, "in_progress").getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(adminReply(viewer, ticketId, "hi").getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    // open -> waiting_on_user is not a transition.
    ResponseEntity<JsonNode> skip = setStatus(handler, ticketId, "waiting_on_user");
    assertThat(skip.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(skip)).isEqualTo("invalid_transition");
    assertThat(code(setStatus(handler, ticketId, "closed"))).isEqualTo("invalid_transition");
    assertThat(setStatus(handler, UUID.randomUUID().toString(), "in_progress").getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    JsonNode moved = ok(setStatus(handler, ticketId, "in_progress"), HttpStatus.OK);
    assertThat(moved.get("status").asText()).isEqualTo("in_progress");
    assertThat(moved.get("ageSeconds").asLong()).isZero();
    ok(setStatus(handler, ticketId, "waiting_on_user"), HttpStatus.OK);
    assertThat(ticketRow(ticketId).get("waiting_since")).isNotNull();
    assertThat(statusNotifications(rider.userId()))
        .containsExactly("in_progress", "waiting_on_user");

    // The reminder: nothing at 47 h, exactly one at 48 h, never twice in one stay.
    advance(Duration.ofHours(47));
    assertThat(ticketReminderService.runReminderPass()).isZero();
    assertThat(outboxEvents(rider.userId())).doesNotContain("support.waiting_reminder");
    advance(Duration.ofHours(1));
    assertThat(ticketReminderService.runReminderPass()).isEqualTo(1);
    assertThat(ticketReminderService.runReminderPass()).isZero();
    assertThat(outboxEvents(rider.userId())).containsOnlyOnce("support.waiting_reminder");
    assertThat(ticketRow(ticketId).get("reminder_sent_at")).isNotNull();
    assertThat(history(ticketId)).contains("reminder_sent/system");
    // The reminder surfaces in the ticket history the user sees (UC-S-20 A1).
    JsonNode detail = ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK);
    assertThat(detail.get("events").findValues("type").stream().map(JsonNode::asText))
        .contains("reminder_sent");
    JsonNode supportMove = null;
    for (JsonNode event : detail.get("events")) {
      if ("support".equals(event.get("actorSide").asText())) {
        supportMove = event;
      }
    }
    assertThat(supportMove).isNotNull();
    assertThat(supportMove.get("actorName").isNull()).as("admin names only to admins").isTrue();

    // The user's reply reopens the discussion: waiting_on_user -> in_progress, stamps cleared.
    JsonNode reply = ok(userReply(rider, ticketId, "Still not applied"), HttpStatus.CREATED);
    assertThat(reply.get("senderSide").asText()).isEqualTo("user");
    assertThat(reply.get("senderName").asText()).isEqualTo("Rana Rider");
    Map<String, Object> row = ticketRow(ticketId);
    assertThat(row.get("status")).isEqualTo("in_progress");
    assertThat(row.get("waiting_since")).isNull();
    assertThat(row.get("reminder_sent_at")).isNull();
    assertThat(history(ticketId)).contains("status_changed/user:waiting_on_user>in_progress");
    assertThat(statusNotifications(rider.userId())).endsWith("in_progress");

    // A second stay gets a fresh reminder.
    ok(setStatus(handler, ticketId, "waiting_on_user"), HttpStatus.OK);
    advance(Duration.ofHours(48));
    assertThat(ticketReminderService.runReminderPass()).isEqualTo(1);
    assertThat(outboxEvents(rider.userId()).stream().filter("support.waiting_reminder"::equals))
        .hasSize(2);
    ok(setStatus(handler, ticketId, "in_progress"), HttpStatus.OK);

    // Support reply: the user is notified, the thread shows "Labby support" to the user.
    JsonNode supportReply =
        ok(adminReply(handler, ticketId, "Applied it manually"), HttpStatus.CREATED);
    assertThat(supportReply.get("senderSide").asText()).isEqualTo("support");
    assertThat(supportReply.get("senderName").asText()).startsWith("Admin ");
    assertThat(outboxEvents(rider.userId())).contains("support.ticket_message");
    assertThat(ticketRow(ticketId).get("status"))
        .as("no implicit move off in_progress")
        .isEqualTo("in_progress");
    JsonNode mine = ok(get("/api/v1/tickets", rider.token()), HttpStatus.OK).get("items").get(0);
    assertThat(mine.get("unreadSupportMessages").asInt()).isEqualTo(1);
    assertThat(mine.get("lastMessageAt").isNull()).isFalse();
    JsonNode thread = ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK);
    assertThat(thread.get("messages")).hasSize(2);
    assertThat(thread.get("messages").get(1).get("senderName").asText()).isEqualTo("Labby support");
    assertThat(
            ok(get("/api/v1/tickets", rider.token()), HttpStatus.OK)
                .get("items")
                .get(0)
                .get("unreadSupportMessages")
                .asInt())
        .as("read by the thread view (V27)")
        .isZero();

    // resolved -> the user's reply reopens -> resolved again -> closed (terminal).
    ok(setStatus(handler, ticketId, "resolved"), HttpStatus.OK);
    assertThat(ticketRow(ticketId).get("resolved_at")).isNotNull();
    ok(userReply(rider, ticketId, "It happened again"), HttpStatus.CREATED);
    row = ticketRow(ticketId);
    assertThat(row.get("status")).isEqualTo("in_progress");
    assertThat(row.get("resolved_at")).isNull();
    ok(setStatus(handler, ticketId, "resolved"), HttpStatus.OK);
    JsonNode closed = ok(setStatus(handler, ticketId, "closed"), HttpStatus.OK);
    assertThat(closed.get("closedAt").isNull()).isFalse();
    assertThat(closed.get("resolvedAt").isNull()).isFalse();
    ResponseEntity<JsonNode> late = userReply(rider, ticketId, "hello?");
    assertThat(late.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(late)).isEqualTo("ticket_closed");
    assertThat(code(adminReply(handler, ticketId, "..."))).isEqualTo("ticket_closed");
    assertThat(code(setStatus(handler, ticketId, "in_progress"))).isEqualTo("invalid_transition");
    assertThat(
            code(
                post(
                    "/api/v1/admin/tickets/" + ticketId + "/priority",
                    Map.of("priority", "urgent"),
                    handler)))
        .isEqualTo("ticket_closed");
    assertThat(statusNotifications(rider.userId()))
        .containsExactly(
            "in_progress",
            "waiting_on_user",
            "in_progress",
            "waiting_on_user",
            "in_progress",
            "resolved",
            "in_progress",
            "resolved",
            "closed");
    assertThat(auditActions(ticketId)).contains("ticket.status", "ticket.reply");
    assertThat(ok(get("/api/v1/admin/tickets", viewer), HttpStatus.OK).get("totalItems").asInt())
        .as("closed tickets leave the default queue")
        .isZero();
    assertThat(
            ok(get("/api/v1/admin/tickets?status=closed", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
  }

  @Test
  @DisplayName(
      "SUP-03 / UC-A-21: the queue sorts priority then age; priority override and assignment"
          + " land in the history without notifying the user; contact access on the detail")
  void shouldSortTheQueueAndHandleAssignment() {
    Account rider = newRider();
    Account otherRider = newRider();
    UUID normal = category("Normal", "normal");
    UUID high = category("High", "high");
    String handler = handler();
    String viewer = viewer();
    UUID handlerId = userIdOf(ok(get("/api/v1/users/me", handler), HttpStatus.OK));
    UUID viewerId = userIdOf(ok(get("/api/v1/users/me", viewer), HttpStatus.OK));

    String oldest = openTicket(rider, normal, "oldest normal").get("ticketId").asText();
    advance(Duration.ofMinutes(1));
    String urgent = openTicket(otherRider, normal, "becomes urgent").get("ticketId").asText();
    advance(Duration.ofMinutes(1));
    String newer = openTicket(rider, normal, "newer normal").get("ticketId").asText();
    advance(Duration.ofMinutes(1));
    String important = openTicket(rider, high, "high by category").get("ticketId").asText();

    JsonNode overridden =
        ok(
            post(
                "/api/v1/admin/tickets/" + urgent + "/priority",
                Map.of("priority", "urgent"),
                handler),
            HttpStatus.OK);
    assertThat(overridden.get("priority").asText()).isEqualTo("urgent");
    assertThat(history(urgent)).contains("priority_changed/support:normal>urgent");
    assertThat(statusNotifications(otherRider.userId())).isEmpty();
    assertThat(auditActions(urgent)).contains("ticket.priority");

    JsonNode queue = ok(get("/api/v1/admin/tickets", viewer), HttpStatus.OK);
    assertThat(queue.get("totalItems").asInt()).isEqualTo(4);
    List<String> order = new ArrayList<>();
    queue.get("items").forEach(item -> order.add(item.get("ticketId").asText()));
    assertThat(order).containsExactly(urgent, important, oldest, newer);
    assertThat(queue.get("items").get(2).get("ageSeconds").asLong()).isEqualTo(180);
    assertThat(
            ok(get("/api/v1/admin/tickets?priority=normal", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(2);
    assertThat(
            ok(get("/api/v1/admin/tickets?userId=" + otherRider.userId(), viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    assertThat(
            ok(get("/api/v1/admin/tickets?categoryId=" + high, viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    assertThat(get("/api/v1/admin/tickets", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    // Assignment: handlers only; assigning an open ticket starts it.
    ResponseEntity<JsonNode> notHandler =
        post(
            "/api/v1/admin/tickets/" + oldest + "/assignee",
            Map.of("assigneeUserId", viewerId.toString()),
            handler);
    assertThat(notHandler.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(notHandler)).isEqualTo("assignee_not_handler");
    JsonNode assigned =
        ok(
            post(
                "/api/v1/admin/tickets/" + oldest + "/assignee",
                Map.of("assigneeUserId", handlerId.toString()),
                handler),
            HttpStatus.OK);
    assertThat(assigned.get("assignee").get("userId").asText()).isEqualTo(handlerId.toString());
    assertThat(assigned.get("status").asText()).isEqualTo("in_progress");
    assertThat(history(oldest))
        .contains("assigned/support:null>" + handlerId, "status_changed/support:open>in_progress");
    assertThat(
            ok(get("/api/v1/admin/tickets?assigneeUserId=" + handlerId, viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    assertThat(
            ok(get("/api/v1/admin/tickets?unassigned=true", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(3);
    Map<String, Object> unassign = new HashMap<>();
    unassign.put("assigneeUserId", null);
    JsonNode unassigned =
        ok(post("/api/v1/admin/tickets/" + oldest + "/assignee", unassign, handler), HttpStatus.OK);
    assertThat(unassigned.get("assignee").isNull()).isTrue();
    assertThat(auditActions(oldest)).contains("ticket.assign");

    // Detail: the user's phone only to handlers; admin names only to admins.
    ok(adminReply(handler, newer, "Looking into it"), HttpStatus.CREATED);
    JsonNode forHandler = ok(get("/api/v1/admin/tickets/" + newer, handler), HttpStatus.OK);
    assertThat(forHandler.get("userPhone").asText()).isEqualTo(rider.phone());
    assertThat(forHandler.get("user").get("name").asText()).isEqualTo("Rana Rider");
    assertThat(forHandler.get("openedBy").get("side").asText()).isEqualTo("user");
    assertThat(forHandler.get("messages").get(0).get("senderName").asText()).startsWith("Admin ");
    assertThat(
            forHandler
                .get("events")
                .get(forHandler.get("events").size() - 1)
                .get("actorName")
                .asText())
        .startsWith("Admin ");
    assertThat(forHandler.get("lostItem").isNull()).isTrue();
    JsonNode forViewer = ok(get("/api/v1/admin/tickets/" + newer, viewer), HttpStatus.OK);
    assertThat(forViewer.get("userPhone").isNull()).isTrue();
    assertThat(get("/api/v1/admin/tickets/" + UUID.randomUUID(), viewer).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("Ruling 9: the one SOS-linked ticket, opened by an admin on the caller's behalf")
  void shouldOpenTheSosLinkedTicket() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID safety = category("Safety", "urgent");
    String handler = handler();
    String viewer = viewer();
    UUID handlerId = userIdOf(ok(get("/api/v1/users/me", handler), HttpStatus.OK));
    UUID ride =
        ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
    String sosEventId =
        ok(
                post(
                    "/api/v1/rides/" + ride + "/sos",
                    Map.of("lat", 33.502, "lng", 36.301, "recordedAt", CLOCK.instant().toString()),
                    rider.token()),
                HttpStatus.CREATED)
            .get("sosEventId")
            .asText();
    String url = "/api/v1/admin/sos-events/" + sosEventId + "/ticket";
    Map<String, Object> body = new HashMap<>();
    body.put("categoryId", safety.toString());
    body.put("description", "Rider called in distress; followed up by phone");

    assertThat(post(url, body, viewer).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post("/api/v1/admin/sos-events/" + UUID.randomUUID() + "/ticket", body, handler)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    Map<String, Object> reserved = new HashMap<>(body);
    reserved.put("categoryId", LOST_ITEM_CATEGORY);
    assertThat(code(post(url, reserved, handler))).isEqualTo("category_reserved");
    assertThat(
            ok(get("/api/v1/admin/sos-events?status=all", viewer), HttpStatus.OK)
                .get("items")
                .get(0)
                .get("ticketId")
                .isNull())
        .isTrue();

    JsonNode ticket = ok(post(url, body, handler), HttpStatus.CREATED);
    assertThat(ticket.get("user").get("userId").asText()).isEqualTo(rider.userId().toString());
    assertThat(ticket.get("openedBy").get("userId").asText()).isEqualTo(handlerId.toString());
    assertThat(ticket.get("openedBy").get("side").asText()).isEqualTo("support");
    assertThat(ticket.get("assignee").get("userId").asText()).isEqualTo(handlerId.toString());
    assertThat(ticket.get("status").asText()).isEqualTo("in_progress");
    assertThat(ticket.get("priority").asText()).isEqualTo("urgent");
    assertThat(ticket.get("sosEventId").asText()).isEqualTo(sosEventId);
    assertThat(ticket.get("ride").get("rideId").asText()).isEqualTo(ride.toString());
    String ticketId = ticket.get("ticketId").asText();
    assertThat(outboxEvents(rider.userId())).contains("support.ticket_created");
    assertThat(auditActions(sosEventId)).contains("sos.ticket");
    assertThat(
            ok(get("/api/v1/admin/sos-events?status=all", viewer), HttpStatus.OK)
                .get("items")
                .get(0)
                .get("ticketId")
                .asText())
        .isEqualTo(ticketId);
    ResponseEntity<JsonNode> again = post(url, body, handler);
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("ticket_already_linked");
    // The caller follows it like any ticket of theirs; an explicit priority wins over the default.
    assertThat(
            ok(get("/api/v1/tickets/" + ticketId, rider.token()), HttpStatus.OK)
                .get("status")
                .asText())
        .isEqualTo("in_progress");
  }

  private static UUID userIdOf(JsonNode me) {
    return UUID.fromString(me.get("id").asText());
  }
}
