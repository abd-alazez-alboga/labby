package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.TicketReminderService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/**
 * Shared fixture of the M14-T2 support integration tests, on top of the trust fixture (active
 * region, controllable clock, riders / drivers, SQL ride fixtures, API ride flows): ticket uploads,
 * admin tokens per permission, ticket categories through the admin API, and readers for the ticket
 * rows, their history and the chat window.
 */
abstract class AbstractSupportIntegrationTest extends AbstractTrustIntegrationTest {

  static final String LOST_ITEM_CATEGORY = "00000000-0000-0000-0000-000000001401";

  @Autowired protected TicketReminderService ticketReminderService;

  private int adminSequence;

  /** An admin of the system Support role ({@code support:view} + {@code support:handle}). */
  protected String handler() {
    return supportAdmin(nextAdminPhone());
  }

  /** An admin holding only {@code support:view}. */
  protected String viewer() {
    String phone = nextAdminPhone();
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES (?, false) RETURNING role_id",
            UUID.class,
            "Viewer " + phone);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = 'support:view'",
        roleId);
    return registerAdmin(phone, roleId);
  }

  /** A ticket category created through the admin API by the super admin. */
  protected UUID category(String nameEn, String priority) {
    JsonNode created =
        ok(
            post(
                "/api/v1/admin/ticket-categories",
                Map.of("nameEn", nameEn, "nameAr", "تصنيف " + nameEn, "defaultPriority", priority),
                admin),
            HttpStatus.CREATED);
    return UUID.fromString(created.get("ticketCategoryId").asText());
  }

  protected ResponseEntity<JsonNode> uploadTicketFile(String token, String kind, byte[] content) {
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    if (content != null) {
      HttpHeaders partHeaders = new HttpHeaders();
      partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
      body.add(
          "file",
          new HttpEntity<>(
              new ByteArrayResource(content) {
                @Override
                public String getFilename() {
                  return "file.bin";
                }
              },
              partHeaders));
    }
    HttpHeaders headers = bearer(token);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    return restTemplate.exchange(
        "/api/v1/ticket-files" + (kind == null ? "" : "?kind=" + kind),
        HttpMethod.POST,
        new HttpEntity<>(body, headers),
        JsonNode.class);
  }

  protected UUID ticketFile(Account account, String kind) {
    ResponseEntity<JsonNode> response = uploadTicketFile(account.token(), kind, PNG);
    assertThat(response.getStatusCode()).as("%s", response.getBody()).isEqualTo(HttpStatus.CREATED);
    return UUID.fromString(response.getBody().get("fileId").asText());
  }

  protected Map<String, Object> ticketBody(UUID categoryId, String description) {
    Map<String, Object> body = new HashMap<>();
    body.put("categoryId", categoryId.toString());
    body.put("description", description);
    return body;
  }

  /** Opens a ticket through the API (201 expected). */
  protected JsonNode openTicket(Account account, UUID categoryId, String description) {
    return ok(
        post("/api/v1/tickets", ticketBody(categoryId, description), account.token()),
        HttpStatus.CREATED);
  }

  protected ResponseEntity<JsonNode> setStatus(String adminToken, String ticketId, String status) {
    return post(
        "/api/v1/admin/tickets/" + ticketId + "/status", Map.of("status", status), adminToken);
  }

  protected ResponseEntity<JsonNode> setCaseStatus(
      String adminToken, String ticketId, String caseStatus) {
    return post(
        "/api/v1/admin/lost-items/" + ticketId + "/case-status",
        Map.of("caseStatus", caseStatus),
        adminToken);
  }

  protected ResponseEntity<JsonNode> userReply(Account account, String ticketId, String body) {
    return post("/api/v1/tickets/" + ticketId + "/messages", Map.of("body", body), account.token());
  }

  protected ResponseEntity<JsonNode> adminReply(String adminToken, String ticketId, String body) {
    return post(
        "/api/v1/admin/tickets/" + ticketId + "/messages", Map.of("body", body), adminToken);
  }

  /** The ticket row's workflow columns. */
  protected Map<String, Object> ticketRow(String ticketId) {
    return jdbcTemplate.queryForMap(
        "SELECT status, case_status, priority, waiting_since, reminder_sent_at, resolved_at,"
            + " closed_at, user_read_at, assignee_user_id FROM support_tickets"
            + " WHERE support_ticket_id = ?",
        UUID.fromString(ticketId));
  }

  /** The ticket's history as {@code type:from>to} strings, oldest first. */
  protected List<String> history(String ticketId) {
    List<String> rows = new ArrayList<>();
    for (Map<String, Object> row :
        jdbcTemplate.queryForList(
            "SELECT type, actor_side, from_value, to_value FROM ticket_events"
                + " WHERE support_ticket_id = ? ORDER BY created_at, ticket_event_id",
            UUID.fromString(ticketId))) {
      rows.add(
          row.get("type")
              + "/"
              + row.get("actor_side")
              + (row.get("to_value") == null
                  ? ""
                  : ":" + row.get("from_value") + ">" + row.get("to_value")));
    }
    return rows;
  }

  /** The window state of the caller's chat thread on a ride. */
  protected String chatWindow(Account account, UUID rideId) {
    return ok(get("/api/v1/rides/" + rideId + "/chat", account.token()), HttpStatus.OK)
        .get("windowState")
        .asText();
  }

  /** A ride completed through the API by an online driver — the chat thread exists and closed. */
  protected UUID completedApiRide(Account rider, Account driver) {
    return completeRide(rider, driver, "cash");
  }

  /** The statuses the user was notified about, in order. */
  protected List<String> statusNotifications(UUID userId) {
    return outboxParams(userId, "support.ticket_status_changed").stream()
        .map(params -> params.replaceAll(".*\"status\"\\s*:\\s*\"([a-z_]+)\".*", "$1"))
        .toList();
  }

  private String nextAdminPhone() {
    return "+9639378%05d".formatted(++adminSequence + 1000 * getClass().getSimpleName().length());
  }
}
