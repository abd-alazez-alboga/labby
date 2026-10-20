package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * V1 audit W30 (owner ruling 2026-10-20, PAY-02 / UC-D-09 E1 "driver marks unpaid → support path"):
 * a mark-unpaid — of a ride or of one shared-ride member — opens a payment support ticket
 * automatically, linked to the ride, on the driver's behalf, visible in the support queue.
 */
class UnpaidRideTicketIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final String UNPAID_CATEGORY = "00000000-0000-0000-0000-000000001402";

  @Test
  @DisplayName("W30: mark-unpaid opens an unpaid_ride ticket for the ride, in the support queue")
  void shouldOpenTicketOnMarkUnpaid() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = completeRide(rider, driver, "cash");
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/mark-unpaid",
            Map.of("note", "rider had no cash"),
            driver.token()),
        HttpStatus.OK);

    Map<String, Object> ticket =
        jdbcTemplate.queryForMap(
            "SELECT support_ticket_id, user_id, opened_by_user_id, ticket_category_id, status,"
                + " submitted_as, description FROM support_tickets WHERE ride_id = ?",
            rideId);
    assertThat(ticket.get("user_id")).isEqualTo(driver.userId());
    assertThat(ticket.get("opened_by_user_id")).isEqualTo(driver.userId());
    assertThat(ticket.get("ticket_category_id").toString()).isEqualTo(UNPAID_CATEGORY);
    assertThat(ticket.get("status")).isEqualTo("open");
    assertThat(ticket.get("submitted_as")).isEqualTo("driver");
    assertThat((String) ticket.get("description"))
        .contains("marked this ride unpaid", "SYP 1.50", "rider had no cash");
    assertThat(outboxEvents(driver.userId())).contains("support.ticket_created");

    // Support sees it in the queue; the driver sees it in their tickets.
    String ticketId = ticket.get("support_ticket_id").toString();
    JsonNode queue = ok(get("/api/v1/admin/tickets", admin), HttpStatus.OK);
    assertThat(queue.get("items").findValuesAsText("ticketId")).contains(ticketId);
    JsonNode mine = ok(get("/api/v1/tickets", driver.token()), HttpStatus.OK);
    assertThat(mine.get("items").findValuesAsText("ticketId")).contains(ticketId);
    // Users can never pick the system category themselves.
    assertThat(
            ok(get("/api/v1/support/ticket-categories", rider.token()), HttpStatus.OK)
                .findValuesAsText("ticketCategoryId"))
        .doesNotContain(UNPAID_CATEGORY);
  }

  @Test
  @DisplayName("W30: a shared member marked unpaid opens a ticket naming that member")
  void shouldOpenTicketOnMemberMarkUnpaid() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account member = rider();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", "cash");
    body.put("totalSeats", 2);
    body.put("partySize", 1);
    body.put("departure", Map.of("mode", "when_full"));
    UUID rideId =
        UUID.fromString(
            ok(post("/api/v1/shared-rides", body, creator.token()), HttpStatus.CREATED)
                .get("rideId")
                .asText());
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash"),
            member.token()),
        HttpStatus.OK);
    advance(Duration.ofSeconds(1));
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    UUID memberId =
        jdbcTemplate.queryForObject(
            "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
                + " rider_user_id = ?",
            UUID.class,
            rideId,
            member.userId());
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/members/" + memberId + "/mark-unpaid",
            null,
            driver.token()),
        HttpStatus.OK);

    List<Map<String, Object>> tickets =
        jdbcTemplate.queryForList(
            "SELECT ticket_category_id, user_id, description FROM support_tickets WHERE"
                + " ride_id = ?",
            rideId);
    assertThat(tickets).hasSize(1);
    assertThat(tickets.get(0).get("ticket_category_id").toString()).isEqualTo(UNPAID_CATEGORY);
    assertThat(tickets.get(0).get("user_id")).isEqualTo(driver.userId());
    assertThat((String) tickets.get(0).get("description")).contains("Rana", "unpaid");
  }
}
