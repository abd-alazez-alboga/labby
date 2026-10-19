package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M14-T2 lost items (LOST-01/02, UC-R-20, UC-D-21, UC-A-22) through the API: the report rules
 * (completed ride, rider only, 3 own photos, one open case per rider per ride), the case as a
 * ticket of the system category, both parties' views, the case machine with its mirrored ticket
 * status and both-party notifications — and the chat window tracking the case EXACTLY: reopened
 * while a case is open (even on a ride older than the 24 h tail), read-only again at closure.
 */
class LostItemsIntegrationTest extends AbstractSupportIntegrationTest {

  private static String reportUrl(UUID rideId) {
    return "/api/v1/rides/" + rideId + "/lost-item";
  }

  private static Map<String, Object> report(String description, List<String> photos) {
    Map<String, Object> body = new HashMap<>();
    body.put("description", description);
    body.put("photoFileIds", photos);
    return body;
  }

  @Test
  @DisplayName(
      "LOST-01: the rider of a COMPLETED ride reports once per ride with up to 3 own photos; the"
          + " case is a high-priority ticket of the system category; both parties are told")
  void shouldReportUnderTheRules() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    Account stranger = newRider();
    UUID ride = completedApiRide(rider, driver);
    Account busyRider = newRider();
    UUID accepted =
        ride(busyRider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);

    ResponseEntity<JsonNode> early =
        post(reportUrl(accepted), report("umbrella", List.of()), busyRider.token());
    assertThat(early.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(early)).isEqualTo("ride_not_completed");
    assertThat(post(reportUrl(ride), report("umbrella", List.of()), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(reportUrl(ride), report("umbrella", List.of()), stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(reportUrl(UUID.randomUUID()), report("umbrella", List.of()), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(post(reportUrl(ride), report("  ", List.of()), rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    reportUrl(ride),
                    report(
                        "umbrella",
                        List.of(
                            ticketFile(rider, "lost_item_photo").toString(),
                            ticketFile(rider, "lost_item_photo").toString(),
                            ticketFile(rider, "lost_item_photo").toString(),
                            ticketFile(rider, "lost_item_photo").toString())),
                    rider.token())
                .getStatusCode())
        .as("more than 3 photos")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    reportUrl(ride),
                    report("umbrella", List.of(ticketFile(rider, "ticket_attachment").toString())),
                    rider.token())
                .getStatusCode())
        .as("a ticket attachment is no lost-item photo")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    reportUrl(ride),
                    report("umbrella", List.of(ticketFile(stranger, "lost_item_photo").toString())),
                    rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    String photo = ticketFile(rider, "lost_item_photo").toString();
    JsonNode opened =
        ok(
            post(
                reportUrl(ride),
                report("Black umbrella on the back seat", List.of(photo)),
                rider.token()),
            HttpStatus.CREATED);
    String ticketId = opened.get("ticketId").asText();
    assertThat(opened.get("caseStatus").asText()).isEqualTo("reported");
    assertThat(opened.get("status").asText()).isEqualTo("open");
    assertThat(opened.get("photos")).hasSize(1);
    assertThat(opened.get("photos").get(0).get("url").asText()).startsWith("/api/v1/files/");
    assertThat(opened.get("ride").get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(opened.get("reporter").get("userId").asText()).isEqualTo(rider.userId().toString());
    assertThat(opened.get("reporter").get("role").asText()).isEqualTo("rider");
    assertThat(opened.get("driver").get("userId").asText()).isEqualTo(driver.userId().toString());
    assertThat(opened.get("chatWindow").asText())
        .as("inside the 24 h tail the window is its own")
        .isEqualTo("open");
    Map<String, Object> row = ticketRow(ticketId);
    assertThat(row.get("priority")).isEqualTo("high");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT ticket_category_id::text FROM support_tickets WHERE support_ticket_id = ?",
                String.class,
                UUID.fromString(ticketId)))
        .isEqualTo(LOST_ITEM_CATEGORY);
    assertThat(outboxEvents(rider.userId())).contains("support.ticket_created");
    assertThat(outboxEvents(driver.userId())).contains("lost_item.case_opened");
    assertThat(outboxParams(rider.userId(), "support.ticket_created").get(0)).contains("lost_item");

    // One open case per rider per ride.
    ResponseEntity<JsonNode> again =
        post(reportUrl(ride), report("also a hat", List.of()), rider.token());
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("lost_item_case_open");

    // Both parties see the case; a stranger does not; the rider's ticket list carries it too.
    assertThat(
            ok(get("/api/v1/lost-items/" + ticketId, driver.token()), HttpStatus.OK)
                .get("caseStatus")
                .asText())
        .isEqualTo("reported");
    assertThat(get("/api/v1/lost-items/" + ticketId, stranger.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            ok(get("/api/v1/lost-items?open=true", driver.token()), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    assertThat(
            ok(get("/api/v1/lost-items", rider.token()), HttpStatus.OK).get("totalItems").asInt())
        .isEqualTo(1);
    JsonNode mine = ok(get("/api/v1/tickets", rider.token()), HttpStatus.OK).get("items").get(0);
    assertThat(mine.get("kind").asText()).isEqualTo("lost_item");
    assertThat(mine.get("caseStatus").asText()).isEqualTo("reported");
    // The thread works like any ticket's but never moves the status (the case does).
    String handler = handler();
    ok(adminReply(handler, ticketId, "We will contact the driver"), HttpStatus.CREATED);
    ok(userReply(rider, ticketId, "Thanks"), HttpStatus.CREATED);
    assertThat(ticketRow(ticketId).get("status")).isEqualTo("open");
    ResponseEntity<JsonNode> direct = setStatus(handler, ticketId, "in_progress");
    assertThat(direct.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(direct)).isEqualTo("use_case_status");
    // The photo belongs to this case only (a fixture ride without a thread gets one at report).
    UUID other = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    assertThat(post(reportUrl(other), report("x", List.of(photo)), rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "LOST-01/02: the chat window tracks the case exactly — reopened from the report (even on a"
          + " ride past the 24 h tail) through every case status, read-only again at closure; the"
          + " ticket status mirrors the case and both parties are notified on every change")
  void shouldReopenAndCloseTheChatWithTheCase() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID ride = completedApiRide(rider, driver);
    String handler = handler();
    String viewer = viewer();
    advance(Duration.ofHours(25));
    assertThat(chatWindow(rider, ride)).isEqualTo("read_only");
    assertThat(chatWindow(driver, ride)).isEqualTo("read_only");

    JsonNode opened =
        ok(
            post(reportUrl(ride), report("Phone charger", List.of()), rider.token()),
            HttpStatus.CREATED);
    String ticketId = opened.get("ticketId").asText();
    assertThat(opened.get("chatWindow").asText()).isEqualTo("reopened");
    assertThat(chatWindow(rider, ride)).isEqualTo("reopened");
    assertThat(chatWindow(driver, ride)).isEqualTo("reopened");
    JsonNode thread = ok(get("/api/v1/rides/" + ride + "/chat", driver.token()), HttpStatus.OK);
    assertThat(thread.get("counterpart").get("phone").isNull())
        .as("CALL-01: the phone comes back with the writable window")
        .isFalse();
    assertThat(
            ok(get("/api/v1/admin/rides/" + ride + "/chat", viewer), HttpStatus.OK)
                .get("windowState")
                .asText())
        .isEqualTo("reopened");
    JsonNode adminDetail = ok(get("/api/v1/admin/tickets/" + ticketId, handler), HttpStatus.OK);
    assertThat(adminDetail.get("lostItem").get("chatWindow").asText()).isEqualTo("reopened");
    assertThat(adminDetail.get("lostItem").get("driver").get("userId").asText())
        .isEqualTo(driver.userId().toString());

    // The queue: open cases only by default, filterable by case status; viewers never progress.
    assertThat(ok(get("/api/v1/admin/lost-items", viewer), HttpStatus.OK).get("totalItems").asInt())
        .isEqualTo(1);
    assertThat(
            ok(get("/api/v1/admin/lost-items?caseStatus=found", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isZero();
    assertThat(setCaseStatus(viewer, ticketId, "driver_contacted").getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    ResponseEntity<JsonNode> skip = setCaseStatus(handler, ticketId, "found");
    assertThat(skip.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(skip)).isEqualTo("invalid_transition");
    assertThat(
            setCaseStatus(handler, UUID.randomUUID().toString(), "driver_contacted")
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    JsonNode contacted = ok(setCaseStatus(handler, ticketId, "driver_contacted"), HttpStatus.OK);
    assertThat(contacted.get("caseStatus").asText()).isEqualTo("driver_contacted");
    assertThat(contacted.get("status").asText()).as("mirrored").isEqualTo("in_progress");
    assertThat(chatWindow(rider, ride)).isEqualTo("reopened");
    ok(setCaseStatus(handler, ticketId, "found"), HttpStatus.OK);
    assertThat(ticketRow(ticketId).get("status")).isEqualTo("in_progress");
    assertThat(chatWindow(driver, ride)).isEqualTo("reopened");
    JsonNode returned = ok(setCaseStatus(handler, ticketId, "returned"), HttpStatus.OK);
    assertThat(returned.get("status").asText()).isEqualTo("resolved");
    assertThat(returned.get("resolvedAt").isNull()).isFalse();
    assertThat(chatWindow(rider, ride)).as("still open until closure").isEqualTo("reopened");
    assertThat(code(setCaseStatus(handler, ticketId, "not_found"))).isEqualTo("invalid_transition");

    JsonNode closed = ok(setCaseStatus(handler, ticketId, "closed"), HttpStatus.OK);
    assertThat(closed.get("status").asText()).isEqualTo("closed");
    assertThat(closed.get("closedAt").isNull()).isFalse();
    assertThat(chatWindow(rider, ride)).isEqualTo("read_only");
    assertThat(chatWindow(driver, ride)).isEqualTo("read_only");
    assertThat(
            ok(get("/api/v1/lost-items/" + ticketId, rider.token()), HttpStatus.OK)
                .get("chatWindow")
                .asText())
        .isEqualTo("read_only");
    assertThat(code(setCaseStatus(handler, ticketId, "driver_contacted")))
        .isEqualTo("invalid_transition");
    assertThat(code(userReply(rider, ticketId, "thanks"))).isEqualTo("ticket_closed");
    assertThat(ok(get("/api/v1/admin/lost-items", viewer), HttpStatus.OK).get("totalItems").asInt())
        .isZero();
    assertThat(
            ok(get("/api/v1/admin/lost-items?caseStatus=closed", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);

    // Both parties notified on every case change, with the status; history and audit complete.
    List<String> riderCase = outboxParams(rider.userId(), "lost_item.case_status_changed");
    List<String> driverCase = outboxParams(driver.userId(), "lost_item.case_status_changed");
    assertThat(riderCase).hasSize(4);
    assertThat(driverCase).hasSize(4);
    assertThat(riderCase.get(0)).contains("driver_contacted").contains("\"as\": \"rider\"");
    assertThat(driverCase.get(3)).contains("closed").contains("\"as\": \"driver\"");
    assertThat(history(ticketId))
        .containsExactlyInAnyOrder(
            "created/user",
            "case_status_changed/support:reported>driver_contacted",
            "status_changed/support:open>in_progress",
            "case_status_changed/support:driver_contacted>found",
            "case_status_changed/support:found>returned",
            "status_changed/support:in_progress>resolved",
            "case_status_changed/support:returned>closed",
            "status_changed/support:resolved>closed");
    assertThat(auditActions(ticketId))
        .containsExactly(
            "lost_item.case_status",
            "lost_item.case_status",
            "lost_item.case_status",
            "lost_item.case_status");

    // A closed case no longer blocks a new report on the same ride, which reopens the chat again.
    JsonNode second =
        ok(
            post(reportUrl(ride), report("Also my scarf", List.of()), rider.token()),
            HttpStatus.CREATED);
    assertThat(second.get("chatWindow").asText()).isEqualTo("reopened");
    assertThat(chatWindow(driver, ride)).isEqualTo("reopened");
    ok(setCaseStatus(handler, second.get("ticketId").asText(), "driver_contacted"), HttpStatus.OK);
    ok(setCaseStatus(handler, second.get("ticketId").asText(), "not_found"), HttpStatus.OK);
    assertThat(ticketRow(second.get("ticketId").asText()).get("status")).isEqualTo("resolved");
    ok(setCaseStatus(handler, second.get("ticketId").asText(), "closed"), HttpStatus.OK);
    assertThat(chatWindow(rider, ride)).isEqualTo("read_only");
  }
}
