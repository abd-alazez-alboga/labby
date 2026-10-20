package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Review V1 W15 (UC-A-18): the ride detail's related reports / tickets / lost-item cases / SOS,
 * each section gated by its own permission; and the rides list's kind filter (export included) with
 * the shared rides' seat and party counts.
 */
class AdminRideRelatedIntegrationTest extends AbstractSupportIntegrationTest {

  private int roleSequence;

  /** An admin whose custom role holds exactly the given permissions. */
  private String adminWith(String... permissions) {
    roleSequence++;
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES (?, false) RETURNING role_id",
            UUID.class,
            "W15 role " + roleSequence);
    for (String permission : permissions) {
      jdbcTemplate.update(
          "INSERT INTO role_permissions (role_id, permission_id)"
              + " SELECT ?, permission_id FROM permissions WHERE code = ?",
          roleId,
          permission);
    }
    return registerAdmin("+96393781" + String.format("%04d", roleSequence), roleId);
  }

  private UUID sos(UUID rideId, UUID userId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO sos_events (sos_event_id, ride_id, triggered_by_user_id, triggered_by_role,"
            + " location, triggered_at) VALUES (?, ?, ?, 'rider',"
            + " ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), now())",
        id,
        rideId,
        userId);
    return id;
  }

  private static List<String> ids(JsonNode items) {
    List<String> ids = new ArrayList<>();
    items.forEach(item -> ids.add(item.get("id").asText()));
    return ids;
  }

  @Test
  @DisplayName("the related sections list the ride's reports, tickets, lost items and SOS")
  void shouldListEverythingFiledAboutTheRide() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID ride = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    UUID otherRide = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    String report =
        ok(
                post(
                    "/api/v1/rides/" + ride + "/reports",
                    Map.of("category", "other", "photoFileIds", List.of()),
                    driver.token()),
                HttpStatus.CREATED)
            .get("id")
            .asText();
    Map<String, Object> ticketBody =
        new HashMap<>(
            ticketBody(category("Payments", "normal"), "Charged twice for one ride\nDetails"));
    ticketBody.put("rideId", ride.toString());
    String ticket =
        ok(post("/api/v1/tickets", ticketBody, rider.token()), HttpStatus.CREATED)
            .get("ticketId")
            .asText();
    String lostItem =
        ok(
                post(
                    "/api/v1/rides/" + ride + "/lost-item",
                    Map.of(
                        "description",
                        "Black backpack on the back seat",
                        "photoFileIds",
                        List.of()),
                    rider.token()),
                HttpStatus.CREATED)
            .get("ticketId")
            .asText();
    UUID sosId = sos(ride, rider.userId());
    sos(otherRide, rider.userId()); // another ride's: not listed

    JsonNode related = ok(get("/api/v1/admin/rides/" + ride + "/related", admin), HttpStatus.OK);
    assertThat(related.get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(ids(related.get("reports"))).containsExactly(report);
    JsonNode reportRow = related.get("reports").get(0);
    assertThat(reportRow.get("ref").asText()).isEqualTo(report.substring(0, 8).toUpperCase());
    assertThat(reportRow.get("status").asText()).isEqualTo("open");
    assertThat(reportRow.get("reporter").get("role").asText()).isEqualTo("driver");
    assertThat(reportRow.get("reported").get("userId").asText())
        .isEqualTo(rider.userId().toString());
    assertThat(ids(related.get("tickets"))).containsExactly(ticket);
    JsonNode ticketRow = related.get("tickets").get(0);
    assertThat(ticketRow.get("summary").asText()).isEqualTo("Charged twice for one ride");
    assertThat(ticketRow.get("categoryNameEn").asText()).isEqualTo("Payments");
    assertThat(ticketRow.get("status").asText()).isEqualTo("open");
    assertThat(ticketRow.get("user").get("role").asText()).isEqualTo("rider");
    assertThat(ids(related.get("lostItems"))).containsExactly(lostItem);
    assertThat(related.get("lostItems").get(0).get("caseStatus").asText()).isEqualTo("reported");
    assertThat(ids(related.get("sos"))).containsExactly(sosId.toString());
    assertThat(related.get("sos").get(0).get("acknowledged").asBoolean()).isFalse();
    assertThat(related.toString()).doesNotContainIgnoringCase("phone"); // no contact data here

    JsonNode empty = ok(get("/api/v1/admin/rides/" + otherRide + "/related", admin), HttpStatus.OK);
    assertThat(empty.get("reports")).isEmpty();
    assertThat(empty.get("tickets")).isEmpty();
    assertThat(empty.get("lostItems")).isEmpty();
    assertThat(empty.get("sos")).hasSize(1);
    assertThat(get("/api/v1/admin/rides/" + UUID.randomUUID() + "/related", admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("each section needs its own permission and is left out otherwise")
  void shouldGateEachSection() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID ride = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    String url = "/api/v1/admin/rides/" + ride + "/related";

    JsonNode ridesOnly = ok(get(url, adminWith("rides:view")), HttpStatus.OK);
    assertThat(ridesOnly.has("reports")).isFalse();
    assertThat(ridesOnly.has("tickets")).isFalse();
    assertThat(ridesOnly.has("lostItems")).isFalse();
    assertThat(ridesOnly.has("sos")).isFalse();

    JsonNode withReports = ok(get(url, adminWith("rides:view", "reports:view")), HttpStatus.OK);
    assertThat(withReports.has("reports")).isTrue();
    assertThat(withReports.has("tickets")).isFalse();

    JsonNode withSupport = ok(get(url, adminWith("rides:view", "support:view")), HttpStatus.OK);
    assertThat(withSupport.has("reports")).isFalse();
    assertThat(withSupport.has("tickets")).isTrue();
    assertThat(withSupport.has("lostItems")).isTrue();
    assertThat(withSupport.has("sos")).isTrue();

    assertThat(get(url, adminWith("support:view", "reports:view")).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get(url, rider.token()).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("kind filters the list and the export; shared rows carry seats and parties")
  void shouldFilterByKindWithSharedCounts() {
    Account creator = newRider();
    Account joiner = newRider();
    Account driver = newDriver();
    UUID onDemand = completedRide(creator.userId(), driver.userId(), CLOCK.instant());
    UUID shared = ride(creator.userId(), null, "no_driver_found", null, null, null, null);
    jdbcTemplate.update("UPDATE rides SET kind = 'shared' WHERE ride_id = ?", shared);
    jdbcTemplate.update(
        "INSERT INTO shared_rides (ride_id, total_seats, seats_taken, departure_mode,"
            + " departure_at) VALUES (?, 4, 3, 'at_time', now() + interval '1 hour')",
        shared);
    jdbcTemplate.update(
        "INSERT INTO shared_ride_members (ride_id, rider_user_id, is_creator, party_size,"
            + " payment_method) VALUES (?, ?, true, 1, 'cash'), (?, ?, false, 2, 'cash')",
        shared,
        creator.userId(),
        shared,
        joiner.userId());

    JsonNode sharedPage = ok(get("/api/v1/admin/rides?kind=shared", admin), HttpStatus.OK);
    assertThat(ids(sharedPage.get("items"))).containsExactly(shared.toString());
    JsonNode row = sharedPage.get("items").get(0);
    assertThat(row.get("kind").asText()).isEqualTo("shared");
    assertThat(row.get("sharedSeats").asInt()).isEqualTo(3);
    assertThat(row.get("sharedParties").asInt()).isEqualTo(2);
    JsonNode onDemandPage = ok(get("/api/v1/admin/rides?kind=on_demand", admin), HttpStatus.OK);
    assertThat(ids(onDemandPage.get("items"))).containsExactly(onDemand.toString());
    assertThat(onDemandPage.get("items").get(0).get("sharedSeats").isNull()).isTrue();
    assertThat(get("/api/v1/admin/rides?kind=bogus", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    ResponseEntity<byte[]> export =
        restTemplate.exchange(
            "/api/v1/admin/exports/rides?kind=shared",
            HttpMethod.GET,
            new HttpEntity<>(bearer(admin)),
            byte[].class);
    assertThat(export.getStatusCode()).isEqualTo(HttpStatus.OK);
    String[] lines =
        new String(export.getBody(), StandardCharsets.UTF_8).substring(1).split("\r\n");
    assertThat(lines).hasSize(2);
    assertThat(lines[1]).startsWith(shared.toString());
  }
}
