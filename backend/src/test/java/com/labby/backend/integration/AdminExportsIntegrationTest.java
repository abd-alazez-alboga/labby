package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.service.AdminDirectoryService;
import com.labby.backend.service.AdminRideService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M15-T1 CSV export (analytics-v1.yaml, ADM-06): each export holds exactly the rows its list shows
 * under the same filters, in the same order; it is audit-logged; phones follow contact access; and
 * the row cap answers 422. The cap is checked on the service reads with a small cap: overriding the
 * configured 50,000 would start an extra Spring context with its own connection pool against the
 * shared test database.
 */
class AdminExportsIntegrationTest extends AbstractSupportIntegrationTest {

  @Autowired private ObjectMapper objectMapper;
  @Autowired private AdminRideService adminRideService;
  @Autowired private AdminDirectoryService adminDirectoryService;

  // ---- helpers ----------------------------------------------------------------------------------

  private ResponseEntity<byte[]> export(String path, String token) {
    return restTemplate.exchange(
        "/api/v1/admin/exports/" + path,
        HttpMethod.GET,
        new HttpEntity<>(bearer(token)),
        byte[].class);
  }

  /** The CSV's data rows split into cells (fixture values hold no comma or quote). */
  private List<String[]> csv(ResponseEntity<byte[]> response) {
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getContentType().toString()).startsWith("text/csv");
    assertThat(response.getHeaders().getContentDisposition().getFilename())
        .matches("labby-[a-z]+-\\d{8}-\\d{6}Z\\.csv");
    String text = new String(response.getBody(), StandardCharsets.UTF_8);
    assertThat(text).startsWith("﻿");
    List<String[]> rows = new ArrayList<>();
    for (String line : text.substring(1).split("\r\n")) {
      rows.add(line.split(",", -1));
    }
    return rows.subList(1, rows.size());
  }

  private static List<String> column(List<String[]> rows, int index) {
    return rows.stream().map(row -> row[index]).toList();
  }

  private static List<String> ids(JsonNode page, String field) {
    List<String> ids = new ArrayList<>();
    page.get("items").forEach(item -> ids.add(item.get(field).asText()));
    return ids;
  }

  private void assertSameRows(String list, String query, String idField) {
    JsonNode page =
        ok(
            get(
                "/api/v1/admin/" + list + "?size=100" + (query.isEmpty() ? "" : "&" + query),
                admin),
            HttpStatus.OK);
    List<String[]> rows = csv(export(list + (query.isEmpty() ? "" : "?" + query), admin));
    assertThat(column(rows, 0))
        .as("%s?%s", list, query)
        .isNotEmpty()
        .containsExactlyElementsOf(ids(page, idField));
  }

  private String analyst() {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES ('Analyst', false) RETURNING role_id",
            UUID.class);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id) SELECT ?, permission_id FROM"
            + " permissions WHERE code IN ('users:view', 'analytics:view', 'analytics:export')",
        roleId);
    return registerAdmin("+963937800009", roleId);
  }

  // ---- tests ------------------------------------------------------------------------------------

  @Test
  @DisplayName("rides: the export equals the list under the same filters, in list order")
  void shouldExportRidesLikeTheList() {
    Account driver = newDriver();
    Account rider = newRider();
    UUID first = completedRide(rider.userId(), driver.userId(), CLOCK.instant().minusSeconds(900));
    completedRide(rider.userId(), driver.userId(), CLOCK.instant().minusSeconds(600));
    ride(rider.userId(), null, "no_driver_found", null, null, null, null);

    assertSameRows("rides", "", "id");
    assertSameRows("rides", "state=completed", "id");
    assertSameRows("rides", "state=completed&from=" + CLOCK.instant().minusSeconds(2000), "id");
    List<String[]> rows = csv(export("rides?state=completed", admin));
    assertThat(rows).hasSize(2);
    assertThat(rows.get(1)[0]).isEqualTo(first.toString()); // newest first
    assertThat(rows.get(1)[2]).isEqualTo("completed");
    assertThat(rows.get(1)[4]).isEqualTo("Damascus Rides");
    assertThat(rows.get(1)[12]).isEqualTo("SYP");
  }

  @Test
  @DisplayName("users and drivers: same rows as the lists; phones only with support:handle")
  void shouldExportUsersAndDriversWithContactAccess() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG); // online
    newDriver(); // offline
    newRider();

    assertSameRows("users", "role=driver", "userId");
    assertSameRows("drivers", "", "userId");
    assertSameRows("drivers", "online=true&regionId=" + regionId, "userId");
    assertSameRows("drivers", "status=approved&online=false", "userId");

    List<String[]> drivers = csv(export("drivers?online=true", admin));
    assertThat(drivers).hasSize(1);
    // Super admin holds support:handle; a leading "+" gets the formula-injection guard quote.
    assertThat(drivers.get(0)[2]).isEqualTo("'" + driver.phone());
    assertThat(drivers.get(0)[3]).isEqualTo("approved");
    assertThat(drivers.get(0)[4]).isEqualTo("true");
    assertThat(drivers.get(0)[5]).isEqualTo("Damascus Rides");

    String analyst = analyst();
    List<String[]> hidden = csv(export("drivers?online=true", analyst));
    assertThat(hidden.get(0)[2]).isEmpty();
    JsonNode page = ok(get("/api/v1/admin/drivers?online=true", analyst), HttpStatus.OK);
    assertThat(page.get("items").get(0).get("phone").isNull()).isTrue();
    List<String[]> users = csv(export("users?role=driver", admin));
    assertThat(users).allSatisfy(row -> assertThat(row[4]).isEqualTo("driver;rider"));

    // page × size beyond int range: an empty page, not a negative OFFSET (500).
    for (String list : List.of("users", "drivers", "transactions")) {
      JsonNode last =
          ok(get("/api/v1/admin/" + list + "?page=2147483647&size=100", admin), HttpStatus.OK);
      assertThat(last.get("items")).as(list).isEmpty();
    }
    assertThat(
            ok(get("/api/v1/admin/users?page=2147483647&size=100", admin), HttpStatus.OK)
                .get("totalItems")
                .asLong())
        .isPositive();
  }

  @Test
  @DisplayName("transactions: wallet + ledger rows like the list, each filter honoured")
  void shouldExportTransactionsLikeTheList() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();
    grant(rider.userId(), "5.00"); // wallet admin_grant
    advance(Duration.ofSeconds(5));
    completeRide(rider, driver, "cash"); // driver ledger commission_due

    assertSameRows("transactions", "", "transactionId");
    assertSameRows("transactions", "source=wallet", "transactionId");
    assertSameRows("transactions", "type=commission_due", "transactionId");
    assertSameRows("transactions", "userId=" + driver.userId(), "transactionId");
    List<String[]> rows = csv(export("transactions", admin));
    assertThat(column(rows, 1)).containsExactly("driver_ledger", "wallet");
    assertThat(rows.get(0)[6]).isEqualTo("-0.38");
    assertThat(rows.get(1)[5]).isEqualTo("admin_grant");
    assertThat(rows.get(1)[6]).isEqualTo("5.00");
    assertThat(get("/api/v1/admin/transactions?type=bogus", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName("tickets: the export follows the queue filter and the queue order")
  void shouldExportTicketsLikeTheQueue() {
    UUID categoryId = category("Billing", "normal");
    UUID urgent = category("Safety", "urgent");
    Account rider = newRider();
    openTicket(rider, categoryId, "Charged twice");
    openTicket(rider, urgent, "Driver was rude");

    assertSameRows("tickets", "", "ticketId");
    assertSameRows("tickets", "priority=urgent", "ticketId");
    List<String[]> rows = csv(export("tickets", admin));
    assertThat(column(rows, 3)).containsExactly("urgent", "normal");
    assertThat(rows.get(0)[4]).isEqualTo("Safety");
    assertThat(rows.get(0)[12]).isEqualTo("Driver was rude");
  }

  @Test
  @DisplayName("every export is audited with its filters and row count")
  void shouldAuditExports() throws Exception {
    Account rider = newRider();
    ride(rider.userId(), null, "no_driver_found", null, null, null, null);
    csv(export("rides?state=no_driver_found", admin));
    csv(export("users?role=rider", admin));

    List<Map<String, Object>> entries =
        jdbcTemplate.queryForList(
            "SELECT action, target_type, target_id, after_state::text AS after FROM audit_log"
                + " WHERE action LIKE 'export.%' ORDER BY created_at");
    assertThat(entries)
        .extracting(row -> row.get("action"))
        .containsExactly("export.rides", "export.users");
    assertThat(entries.get(0).get("target_type")).isEqualTo("export");
    JsonNode after = objectMapper.readTree((String) entries.get(0).get("after"));
    assertThat(after.get("rows").asInt()).isEqualTo(1);
    assertThat(after.get("filters").get("state").asText()).isEqualTo("no_driver_found");
  }

  @Test
  @DisplayName("above the row cap: export_too_large (422) with the limit and the matching rows")
  void shouldRefuseOversizedExports() {
    Account rider = newRider();
    for (int i = 0; i < 3; i++) {
      ride(rider.userId(), null, "no_driver_found", null, null, null, null);
    }
    // The cap is a parameter of every list's export read (the controller passes the configured
    // 50,000); a small cap crosses it without a 50,001-row fixture.
    AdminRideService.Filter all =
        new AdminRideService.Filter(null, null, null, null, null, null, null);
    assertThatThrownBy(() -> adminRideService.searchAll(all, 2))
        .isInstanceOfSatisfying(
            BusinessRuleViolationException.class,
            ex -> {
              assertThat(ex.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
              assertThat(ex.getCode()).isEqualTo("export_too_large");
              assertThat(ex.getDetails()).containsEntry("limit", 2).containsEntry("rows", 3L);
            });
    assertThat(adminRideService.searchAll(all, 3)).hasSize(3);
    assertThatThrownBy(
            () ->
                adminDirectoryService.allUsers(
                    new AdminDirectoryService.UserFilter(null, null, null), 1))
        .hasMessageContaining("narrow the filters");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM audit_log WHERE action LIKE 'export.%'", Long.class))
        .isZero();
  }

  @Test
  @DisplayName("a cross-origin export exposes Content-Disposition to the admin dashboard")
  void shouldExposeTheFileNameToTheDashboard() {
    HttpHeaders headers = bearer(admin);
    headers.setOrigin("http://localhost:5173");
    ResponseEntity<byte[]> response =
        restTemplate.exchange(
            "/api/v1/admin/exports/users", HttpMethod.GET, new HttpEntity<>(headers), byte[].class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getAccessControlExposeHeaders())
        .contains(HttpHeaders.CONTENT_DISPOSITION);
  }

  @Test
  @DisplayName("exports need analytics:export AND the list's own view permission")
  void shouldGateExports() {
    String support = supportAdmin("+963937800008"); // support:view, no analytics:export
    String analyst = analyst(); // analytics:export + users:view only
    assertThat(export("tickets", support).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(export("users", analyst).getStatusCode()).isEqualTo(HttpStatus.OK);
    for (String list : Arrays.asList("rides", "tickets", "transactions")) {
      assertThat(export(list, analyst).getStatusCode()).as(list).isEqualTo(HttpStatus.FORBIDDEN);
    }
    assertThat(get("/api/v1/admin/transactions", analyst).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }
}
