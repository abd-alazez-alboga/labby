package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.SharedRideService;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M12-T2 Phase B (scheduled-shared-v1.yaml, RIDE-P1..5, UC-R-12..15, UC-D-13) on the controlled
 * clock: create rules, browse, join and the last-seat race, leave before / after / at the dispatch
 * moment, the three dispatch triggers, "when full" expiry, capacity-aware dispatch, member no-show,
 * the per-seat split at completion, driver re-dispatch moving the group, member reads and the
 * suspension side effect.
 */
class SharedRideIntegrationTest extends AbstractRideIntegrationTest {

  @Autowired private SharedRideService sharedRideService;

  @Test
  @DisplayName("RIDE-P1 / UC-R-12: seats vs capacity, party vs seats, departure in the future")
  void shouldValidateCreation() {
    Account creator = rider();
    ResponseEntity<JsonNode> noVehicle = tryCreate(creator, 2, 1, whenFull());
    assertThat(code(noVehicle)).isEqualTo("seats_unavailable");
    driverAt(PICKUP_LAT, PICKUP_LNG); // a 4-seat Economy vehicle now serves the region
    ResponseEntity<JsonNode> tooMany = tryCreate(creator, 5, 1, whenFull());
    assertThat(code(tooMany)).isEqualTo("seats_unavailable");
    assertThat(tooMany.getBody().path("details").path("maxSeats").asInt()).isEqualTo(4);
    assertThat(code(tryCreate(creator, 3, 4, whenFull()))).isEqualTo("party_too_large");
    assertThat(
            code(
                tryCreate(creator, 2, 1, Map.of("mode", "at_time", "departAt", in(-1).toString()))))
        .isEqualTo("departure_in_past");
    JsonNode created = ok(tryCreate(creator, 3, 1, atTime(in(60))), HttpStatus.CREATED);
    assertThat(created.get("state").asText()).isEqualTo("gathering");
    assertThat(created.get("seatsLeft").asInt()).isEqualTo(2);
    assertThat(created.get("isCreator").asBoolean()).isTrue();
    assertThat(created.get("pricedAtDispatch").asBoolean()).isTrue();
    // One open shared ride at a time.
    assertThat(code(tryCreate(creator, 3, 1, whenFull()))).isEqualTo("active_ride_exists");
  }

  @Test
  @DisplayName("UC-R-13: browse by region, destination and time; occupancy, never member names")
  void shouldBrowseOpenRides() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID timed = create(rider(), 3, 1, atTime(in(120)));
    UUID full = create(rider(), 4, 2, whenFull());
    Account browser = rider();
    JsonNode page = browse(browser, "");
    assertThat(page.get("totalItems").asLong()).isEqualTo(2);
    assertThat(page.get("items").get(0).get("rideId").asText()).isEqualTo(timed.toString());
    assertThat(page.get("items").get(1).get("rideId").asText()).isEqualTo(full.toString());
    assertThat(page.get("items").get(1).get("seatsTaken").asInt()).isEqualTo(2);
    assertThat(page.get("items").get(1).get("me").isNull()).isTrue();
    // Out of the time range only the "when full" ride still matches; far destinations none.
    assertThat(browse(browser, "&departFrom=" + in(180)).get("totalItems").asLong()).isEqualTo(1);
    assertThat(
            browse(browser, "&destLat=33.59&destLng=36.39&destRadiusM=500")
                .get("totalItems")
                .asLong())
        .isZero();
    assertThat(
            browse(browser, "&destLat=" + DEST_LAT + "&destLng=" + DEST_LNG)
                .get("totalItems")
                .asLong())
        .isEqualTo(2);
    ResponseEntity<JsonNode> outside = get("/api/v1/shared-rides?lat=10&lng=10", browser.token());
    assertThat(code(outside)).isEqualTo("outside_region");
  }

  @Test
  @DisplayName("RIDE-P2 race: two joiners for the last seats — one wins, seats never oversold")
  void shouldLetExactlyOneJoinerTakeTheLastSeats() throws Exception {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = create(rider(), 4, 1, whenFull());
    Account first = rider();
    Account second = rider();
    List<HttpStatus> statuses =
        simultaneously(() -> tryJoin(first, rideId, 2), () -> tryJoin(second, rideId, 2));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    Account loser = statuses.get(0) == HttpStatus.OK ? second : first;
    ResponseEntity<JsonNode> again = tryJoin(loser, rideId, 2);
    assertThat(code(again)).isEqualTo("insufficient_seats");
    assertThat(again.getBody().path("details").path("seatsLeft").asInt()).isEqualTo(1);
    assertThat(seatsTaken(rideId)).isEqualTo(3);
    assertThat(code(tryJoin(statuses.get(0) == HttpStatus.OK ? first : second, rideId, 1)))
        .isEqualTo("already_member");
    // The last seat fills it: dispatch (trigger full), a late joiner finds it closed.
    ok(tryJoin(loser, rideId, 1), HttpStatus.OK);
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(trigger(rideId)).isEqualTo("full");
    assertThat(code(tryJoin(rider(), rideId, 1))).isEqualTo("shared_ride_closed");
  }

  @Test
  @DisplayName("UC-R-14: leave before dispatch is free and frees seats; the creator must cancel")
  void shouldLeaveBeforeDispatch() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 4, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 2), HttpStatus.OK);
    assertThat(seatsTaken(rideId)).isEqualTo(3);
    JsonNode quote =
        ok(get("/api/v1/shared-rides/" + rideId + "/leave-quote", member.token()), HttpStatus.OK);
    assertThat(quote.get("free").asBoolean()).isTrue();
    JsonNode left = ok(leave(member, rideId), HttpStatus.OK);
    assertThat(left.get("me").get("status").asText()).isEqualTo("left");
    assertThat(seatsTaken(rideId)).isEqualTo(1);
    // A member who left may join again while seats remain.
    ok(tryJoin(member, rideId, 1), HttpStatus.OK);
    assertThat(code(leave(creator, rideId))).isEqualTo("creator_must_cancel");
  }

  @Test
  @DisplayName("RIDE-P5 edge: a leave racing the creator's start is judged by the state it finds")
  void shouldResolveLeaveAtTheDispatchMoment() throws Exception {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 4, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 2), HttpStatus.OK);
    List<HttpStatus> statuses =
        simultaneously(
            () -> post("/api/v1/shared-rides/" + rideId + "/start", null, creator.token()),
            () -> leave(member, rideId));
    assertThat(statuses).containsOnly(HttpStatus.OK);
    Map<String, Object> row =
        jdbcTemplate.queryForMap(
            "SELECT status, cancellation_fee FROM shared_ride_members WHERE ride_id = ? AND"
                + " NOT is_creator",
            rideId);
    // Before dispatch it is a free leave; just after, a pre-acceptance (free) cancellation.
    assertThat(row.get("status")).isIn("left", "cancelled");
    assertThat(row.get("cancellation_fee")).isNull();
    assertThat(seatsTaken(rideId)).isEqualTo(1);
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(trigger(rideId)).isEqualTo("creator");
  }

  @Test
  @DisplayName("RIDE-P3: dispatch needs vehicle seats ≥ seats taken; the offer shows the group")
  void shouldDispatchToVehicleWithEnoughSeats() {
    Account small = driverAt(PICKUP_LAT, PICKUP_LNG); // 4 seats, at the pickup
    Account large = driverAt(PICKUP_LAT + 0.01, PICKUP_LNG); // 6 seats, farther
    jdbcTemplate.update("UPDATE vehicles SET seats = 6 WHERE driver_user_id = ?", large.userId());
    Account creator = rider();
    UUID rideId = create(creator, 6, 3, whenFull());
    ok(tryJoin(rider(), rideId, 2), HttpStatus.OK);
    ok(post("/api/v1/shared-rides/" + rideId + "/start", null, creator.token()), HttpStatus.OK);
    dispatch();
    assertThat(hasOpenOffer(small)).isFalse();
    JsonNode offer = openOffer(large);
    assertThat(offer.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(offer.get("shared").get("seats").asInt()).isEqualTo(5);
    assertThat(offer.get("shared").get("parties").asInt()).isEqualTo(2);
  }

  @Test
  @DisplayName("Rulings 2026-10-16: timed rides leave at their time; 'when full' expires at 24 h")
  void shouldDepartAtTimeAndExpireWhenNotFull() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID timed = create(rider(), 3, 1, atTime(in(30)));
    Account creator = rider();
    UUID unfilled = create(creator, 3, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, unfilled, 1), HttpStatus.OK);
    sharedRideService.processDue();
    assertThat(stateOf(timed)).isEqualTo("gathering");
    advance(Duration.ofMinutes(30));
    sharedRideService.processDue();
    assertThat(stateOf(timed)).isEqualTo("requested");
    assertThat(trigger(timed)).isEqualTo("departure_time");
    assertThat(stateOf(unfilled)).isEqualTo("gathering");
    advance(Duration.ofHours(24));
    sharedRideService.processDue();
    assertThat(stateOf(unfilled)).isEqualTo("cancelled_by_rider");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM rides WHERE ride_id = ?", String.class, unfilled))
        .isEqualTo("shared_expired");
    assertThat(outboxEvents(member.userId())).contains("shared.cancelled");
    assertThat(outboxEvents(creator.userId())).contains("shared.cancelled");
  }

  @Test
  @DisplayName("UC-R-15: the creator cancels the group before dispatch; members are told")
  void shouldCancelGroup() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 3, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 1), HttpStatus.OK);
    assertThat(
            post(
                    "/api/v1/shared-rides/" + rideId + "/cancel",
                    Map.of("reason", "changed_mind"),
                    member.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    JsonNode cancelled =
        ok(
            post(
                "/api/v1/shared-rides/" + rideId + "/cancel",
                Map.of("reason", "changed_mind"),
                creator.token()),
            HttpStatus.OK);
    assertThat(cancelled.get("state").asText()).isEqualTo("cancelled_by_rider");
    assertThat(outboxEvents(member.userId())).contains("shared.cancelled");
    // Both are free for another ride now.
    create(member, 3, 1, whenFull());
  }

  @Test
  @DisplayName("UC-D-13 / RIDE-P4: a no-show pays the fee; the fare splits over the boarded seats")
  void shouldSplitFareOverBoardedSeatsWithNoShow() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 4, 1, whenFull());
    Account cashMember = rider();
    Account absent = rider();
    ok(tryJoin(cashMember, rideId, 2), HttpStatus.OK);
    ok(tryJoin(absent, rideId, 1), HttpStatus.OK); // fills it → dispatch
    dispatchAndAccept(rideId, driver);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    JsonNode driverView = ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK);
    assertThat(driverView.get("shared").get("members")).hasSize(3);
    assertThat(driverView.get("shared").get("members").get(0).get("firstName").asText())
        .isNotBlank();
    UUID absentMember = memberId(rideId, absent.userId());
    ResponseEntity<JsonNode> early = noShow(driver, rideId, absentMember);
    assertThat(code(early)).isEqualTo("wait_grace_running");
    advance(Duration.ofMinutes(6));
    ok(noShow(driver, rideId, absentMember), HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_fee FROM shared_ride_members WHERE shared_ride_member_id = ?",
                BigDecimal.class,
                absentMember))
        .isEqualByComparingTo("2.00");
    assertThat(outboxEvents(absent.userId())).contains("shared.member_no_show");
    // The whole-ride no-show cancel is not for shared rides.
    assertThat(
            code(
                post(
                    "/api/v1/driver/rides/" + rideId + "/cancel",
                    Map.of("reason", "rider_no_show"),
                    driver.token())))
        .isEqualTo("use_member_no_show");
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    position(driver, DEST_LAT, DEST_LNG);
    advance(Duration.ofMinutes(10));
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(completed.get("paymentStatus").asText()).isEqualTo("split");
    BigDecimal total = completed.get("fare").get("components").get("total").decimalValue();
    JsonNode split = completed.get("shared").get("split");
    assertThat(split.get("boardedSeats").asInt()).isEqualTo(3);
    List<Map<String, Object>> shares =
        jdbcTemplate.queryForList(
            "SELECT is_creator, party_size, share_amount, status FROM shared_ride_members WHERE"
                + " ride_id = ? AND status = 'completed' ORDER BY joined_at",
            rideId);
    assertThat(shares).hasSize(2);
    BigDecimal sum =
        shares.stream()
            .map(row -> (BigDecimal) row.get("share_amount"))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    assertThat(sum).isEqualByComparingTo(total);
    BigDecimal perSeat = split.get("perSeatAmount").decimalValue();
    assertThat((BigDecimal) shares.get(1).get("share_amount"))
        .isEqualByComparingTo(perSeat.multiply(BigDecimal.valueOf(2)));
    assertThat(outboxEvents(cashMember.userId())).contains("ride.completed");
    // Member reads: the joiner sees the ride with their own membership and in their history.
    JsonNode memberView = riderRide(cashMember, rideId);
    assertThat(memberView.get("shared").get("me").get("status").asText()).isEqualTo("completed");
    assertThat(memberView.get("shared").get("members")).isEmpty();
    JsonNode history = ok(get("/api/v1/rides", cashMember.token()), HttpStatus.OK);
    assertThat(history.get("items").get(0).get("id").asText()).isEqualTo(rideId.toString());
  }

  @Test
  @DisplayName("UC-D-13 E1: when every party is absent the ride ends as a no-show, no re-dispatch")
  void shouldEndRideWhenEveryoneIsAbsent() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 2, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 1), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    // The member's live ride is the shared one.
    assertThat(ok(get("/api/v1/rides/active", member.token()), HttpStatus.OK).get("id").asText())
        .isEqualTo(rideId.toString());
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    advance(Duration.ofMinutes(6));
    ok(noShow(driver, rideId, memberId(rideId, creator.userId())), HttpStatus.OK);
    ok(noShow(driver, rideId, memberId(rideId, member.userId())), HttpStatus.OK);
    assertThat(stateOf(rideId)).isEqualTo("cancelled_by_driver");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rides WHERE redispatch_of_ride_id = ?",
                Integer.class,
                rideId))
        .isZero();
  }

  @Test
  @DisplayName("Driver cancel: the group moves to the re-dispatched ride; route changes refused")
  void shouldMoveGroupOnDriverCancel() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 3, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 2), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    Map<String, Object> route = new LinkedHashMap<>();
    route.put("destination", place(DEST_LAT, DEST_LNG));
    route.put("stops", List.of());
    assertThat(put("/api/v1/rides/" + rideId + "/route", route, creator.token()).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(
            post(
                    "/api/v1/rides/" + rideId + "/cancel",
                    Map.of("reason", "changed_mind"),
                    creator.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "vehicle_issue"),
            driver.token()),
        HttpStatus.OK);
    UUID next =
        jdbcTemplate.queryForObject(
            "SELECT ride_id FROM rides WHERE redispatch_of_ride_id = ?", UUID.class, rideId);
    assertThat(seatsTaken(next)).isEqualTo(3);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM shared_ride_members WHERE ride_id = ? AND status = 'joined'",
                Integer.class,
                next))
        .isEqualTo(2);
    assertThat(ok(get("/api/v1/rides/active", member.token()), HttpStatus.OK).get("id").asText())
        .isEqualTo(next.toString());
  }

  @Test
  @DisplayName("RIDE-P5: the last member leaving after acceptance ends the ride; a fee after grace")
  void shouldChargeMemberLeavingAfterGraceAndEndWithLast() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 2, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 1), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    advance(Duration.ofMinutes(3)); // past the 2-minute grace
    // After dispatch leaving is a cancellation: a reason is required.
    assertThat(
            post("/api/v1/shared-rides/" + rideId + "/leave", Map.of(), member.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    JsonNode left =
        ok(
            post(
                "/api/v1/shared-rides/" + rideId + "/leave",
                Map.of("reason", "changed_mind"),
                member.token()),
            HttpStatus.OK);
    assertThat(left.get("me").get("status").asText()).isEqualTo("cancelled");
    assertThat(left.get("me").get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/leave",
            Map.of("reason", "changed_mind"),
            creator.token()),
        HttpStatus.OK);
    assertThat(stateOf(rideId)).isEqualTo("cancelled_by_rider");
    assertThat(outboxEvents(driver.userId())).contains("ride.cancelled_by_rider");
  }

  @Test
  @DisplayName("Suspension: a suspended creator's gathering group is cancelled for everyone")
  void shouldCancelGroupOfSuspendedCreator() {
    driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    UUID rideId = create(creator, 3, 1, whenFull());
    Account member = rider();
    ok(tryJoin(member, rideId, 1), HttpStatus.OK);
    assertThat(
            post(
                    "/api/v1/admin/users/" + creator.userId() + "/suspend",
                    Map.of("note", "Investigation"),
                    admin)
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();
    assertThat(stateOf(rideId)).isEqualTo("cancelled_by_rider");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM rides WHERE ride_id = ?", String.class, rideId))
        .isEqualTo("account_suspended");
    assertThat(outboxEvents(member.userId())).contains("shared.cancelled");
  }

  // ---- helpers -------------------------------------------------------------------------------

  private Instant in(int minutes) {
    return CLOCK.instant().plus(Duration.ofMinutes(minutes));
  }

  private static Map<String, Object> whenFull() {
    return Map.of("mode", "when_full");
  }

  private static Map<String, Object> atTime(Instant departAt) {
    return Map.of("mode", "at_time", "departAt", departAt.toString());
  }

  private ResponseEntity<JsonNode> tryCreate(
      Account creator, int totalSeats, int partySize, Map<String, Object> departure) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", "cash");
    body.put("totalSeats", totalSeats);
    body.put("partySize", partySize);
    body.put("departure", departure);
    return post("/api/v1/shared-rides", body, creator.token());
  }

  private UUID create(Account creator, int totalSeats, int partySize, Map<String, Object> dep) {
    JsonNode ride = ok(tryCreate(creator, totalSeats, partySize, dep), HttpStatus.CREATED);
    return UUID.fromString(ride.get("rideId").asText());
  }

  private ResponseEntity<JsonNode> tryJoin(Account rider, UUID rideId, int partySize) {
    return post(
        "/api/v1/shared-rides/" + rideId + "/join",
        Map.of("partySize", partySize, "paymentMethod", "cash"),
        rider.token());
  }

  private ResponseEntity<JsonNode> leave(Account rider, UUID rideId) {
    return post(
        "/api/v1/shared-rides/" + rideId + "/leave",
        Map.of("reason", "changed_mind"),
        rider.token());
  }

  private JsonNode browse(Account rider, String query) {
    return ok(
        get("/api/v1/shared-rides?lat=" + PICKUP_LAT + "&lng=" + PICKUP_LNG + query, rider.token()),
        HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> noShow(Account driver, UUID rideId, UUID memberId) {
    return post(
        "/api/v1/driver/rides/" + rideId + "/members/" + memberId + "/no-show",
        null,
        driver.token());
  }

  private UUID memberId(UUID rideId, UUID riderUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
            + " rider_user_id = ? AND status = 'joined'",
        UUID.class,
        rideId,
        riderUserId);
  }

  private int seatsTaken(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT seats_taken FROM shared_rides WHERE ride_id = ?", Integer.class, rideId);
  }

  private String trigger(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT dispatch_trigger FROM shared_rides WHERE ride_id = ?", String.class, rideId);
  }
}
