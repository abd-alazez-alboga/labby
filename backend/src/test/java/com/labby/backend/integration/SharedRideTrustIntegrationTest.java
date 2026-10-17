package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.ChatService;
import java.time.Duration;
import java.time.OffsetDateTime;
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
 * M12-T2 Phase C2 (scheduled-shared-v1.yaml "Shared rides in the other contracts"): a member is the
 * ride's rider for ratings, reports, SOS and trip sharing; the driver rates and reports each member
 * by {@code ?memberId=}; chat is one private thread per member with the driver (V21).
 */
class SharedRideTrustIntegrationTest extends AbstractRideIntegrationTest {

  @Autowired private ChatService chatService;

  @Test
  @DisplayName("RATE-01 per pair: members rate the driver; the driver rates each member")
  void shouldRatePerPair() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account member = rider();
    UUID rideId = sharedRide(creator, member, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    UUID creatorMember = memberId(rideId, creator.userId());
    UUID joinedMember = memberId(rideId, member.userId());

    // The driver gets one prompt per completed member.
    JsonNode pending = ok(get("/api/v1/ratings/pending?as=driver", driver.token()), HttpStatus.OK);
    assertThat(pending).hasSize(2);
    assertThat(pending.findValuesAsText("memberId"))
        .containsExactlyInAnyOrder(creatorMember.toString(), joinedMember.toString());
    // On a shared ride the driver must name the member.
    assertThat(code(rate(driver, rideId, null, 5))).isEqualTo("member_required");
    assertThat(rate(driver, rideId, UUID.randomUUID(), 5).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(rate(driver, rideId, joinedMember, 5).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(code(rate(driver, rideId, joinedMember, 4))).isEqualTo("rating_already_submitted");
    assertThat(myRating(driver, "/api/v1/driver/rides/" + rideId).get("state").asText())
        .isEqualTo("pending");
    assertThat(rate(driver, rideId, creatorMember, 3).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    JsonNode driverRating = myRating(driver, "/api/v1/driver/rides/" + rideId);
    assertThat(driverRating.get("state").asText()).isEqualTo("submitted");
    assertThat(driverRating.path("score").isMissingNode() || driverRating.get("score").isNull())
        .isTrue();
    assertThat(ok(get("/api/v1/ratings/pending?as=driver", driver.token()), HttpStatus.OK))
        .isEmpty();

    // Each member rates the driver once, on their own.
    assertThat(
            ok(get("/api/v1/ratings/pending?as=rider", member.token()), HttpStatus.OK)
                .get(0)
                .get("rideId")
                .asText())
        .isEqualTo(rideId.toString());
    assertThat(rate(member, rideId, null, 5).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(code(rate(member, rideId, null, 5))).isEqualTo("rating_already_submitted");
    assertThat(myRating(member, "/api/v1/rides/" + rideId).get("score").asInt()).isEqualTo(5);
    assertThat(myRating(creator, "/api/v1/rides/" + rideId).get("state").asText())
        .isEqualTo("pending");
    assertThat(rate(creator, rideId, null, 4).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(rate(rider(), rideId, null, 4).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM ratings WHERE ride_id = ?", Integer.class, rideId))
        .isEqualTo(4);
  }

  @Test
  @DisplayName("REP-01 / SAFE-01 / SHARE-01: members report, SOS and share; driver reports each")
  void shouldReportShareAndSosAsMember() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account member = rider();
    UUID rideId = sharedRide(creator, member, driver);
    UUID creatorMember = memberId(rideId, creator.userId());
    UUID joinedMember = memberId(rideId, member.userId());

    // A member (not the creator) is a party for SOS and trip sharing.
    assertThat(
            post(
                    "/api/v1/rides/" + rideId + "/sos",
                    Map.of("lat", 33.502, "lng", 36.301, "recordedAt", CLOCK.instant().toString()),
                    member.token())
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();
    assertThat(
            post("/api/v1/rides/" + rideId + "/share-links", null, member.token())
                .getStatusCode()
                .is2xxSuccessful())
        .isTrue();
    assertThat(
            post("/api/v1/rides/" + rideId + "/share-links", null, rider().token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // Reports: the member reports the driver; the driver reports each member by memberId.
    assertThat(report(member, rideId, null, "unsafe_driving").getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(code(report(driver, rideId, null, "other"))).isEqualTo("member_required");
    assertThat(report(driver, rideId, joinedMember, "inappropriate_behavior").getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(code(report(driver, rideId, joinedMember, "other")))
        .isEqualTo("report_already_submitted");
    assertThat(report(driver, rideId, creatorMember, "vehicle_damage").getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT reported_user_id FROM reports WHERE ride_id = ? AND reporter_role ="
                    + " 'driver'",
                UUID.class,
                rideId))
        .containsExactlyInAnyOrder(creator.userId(), member.userId());
  }

  @Test
  @DisplayName("CHAT-01 per member: private threads with the driver, addressed by memberId")
  void shouldKeepOneThreadPerMember() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account member = rider();
    UUID rideId = sharedRide(creator, member, driver);
    UUID creatorMember = memberId(rideId, creator.userId());
    UUID joinedMember = memberId(rideId, member.userId());
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT rider_user_id FROM chat_threads WHERE ride_id = ?", UUID.class, rideId))
        .containsExactlyInAnyOrder(creator.userId(), member.userId());

    // A member's thread: the counterpart is the driver; the driver names the member.
    assertThat(
            ok(get(chat(rideId, null), member.token()), HttpStatus.OK)
                .get("counterpart")
                .get("role")
                .asText())
        .isEqualTo("driver");
    assertThat(code(get(chat(rideId, null), driver.token()))).isEqualTo("member_required");
    JsonNode driverThread = ok(get(chat(rideId, joinedMember), driver.token()), HttpStatus.OK);
    assertThat(driverThread.get("counterpart").get("role").asText()).isEqualTo("rider");
    assertThat(driverThread.get("counterpart").get("phone").asText()).isEqualTo(member.phone());

    // A member's message reaches only their own thread; the driver's push names the member.
    chatService.send(
        member.userId(),
        new ChatService.SendRequest(
            rideId, UUID.randomUUID(), "text", "I am at the gate", null, null));
    chatService.send(
        driver.userId(),
        new ChatService.SendRequest(
            rideId, UUID.randomUUID(), "text", "On my way", null, creatorMember));
    assertThat(messages(rideId, joinedMember, driver)).containsExactly("I am at the gate");
    assertThat(messages(rideId, creatorMember, driver)).containsExactly("On my way");
    assertThat(messages(rideId, null, member)).containsExactly("I am at the gate");
    assertThat(messages(rideId, null, creator)).containsExactly("On my way");
    assertThat(
            ok(get(chat(rideId, joinedMember), driver.token()), HttpStatus.OK)
                .get("unreadCount")
                .asLong())
        .isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT params->>'memberId' FROM notification_outbox WHERE user_id = ? AND"
                    + " event = 'chat.message'",
                String.class,
                driver.userId()))
        .isEqualTo(joinedMember.toString());

    // Admin support reads one member's thread at a time.
    String log = "/api/v1/admin/rides/" + rideId + "/chat";
    assertThat(code(get(log, admin))).isEqualTo("member_required");
    JsonNode adminLog = ok(get(log + "?memberId=" + joinedMember, admin), HttpStatus.OK);
    assertThat(adminLog.get("items")).hasSize(1);

    // A member who cancels after acceptance: their thread's window closes 24 h after their exit;
    // the other member's stays open.
    advance(Duration.ofMinutes(1));
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/leave",
            Map.of("reason", "changed_mind"),
            member.token()),
        HttpStatus.OK);
    assertThat(closedAt(rideId, member.userId()).toInstant())
        .isEqualTo(CLOCK.instant().plus(Duration.ofHours(24)));
    assertThat(closedAt(rideId, creator.userId())).isNull();
  }

  // ---- helpers -------------------------------------------------------------------------------

  /** A 2-seat "when full" shared ride: creator + member (full → dispatched), accepted. */
  private UUID sharedRide(Account creator, Account member, Account driver) {
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
    dispatchAndAccept(rideId, driver);
    return rideId;
  }

  private UUID memberId(UUID rideId, UUID riderUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
            + " rider_user_id = ? ORDER BY joined_at DESC LIMIT 1",
        UUID.class,
        rideId,
        riderUserId);
  }

  private ResponseEntity<JsonNode> rate(Account rater, UUID rideId, UUID memberId, int score) {
    return post(
        "/api/v1/rides/" + rideId + "/rating" + (memberId == null ? "" : "?memberId=" + memberId),
        Map.of("score", score),
        rater.token());
  }

  private JsonNode myRating(Account account, String rideUrl) {
    return ok(get(rideUrl, account.token()), HttpStatus.OK).get("myRating");
  }

  private ResponseEntity<JsonNode> report(
      Account reporter, UUID rideId, UUID memberId, String category) {
    return post(
        "/api/v1/rides/" + rideId + "/reports" + (memberId == null ? "" : "?memberId=" + memberId),
        Map.of("category", category),
        reporter.token());
  }

  private static String chat(UUID rideId, UUID memberId) {
    return "/api/v1/rides/" + rideId + "/chat" + (memberId == null ? "" : "?memberId=" + memberId);
  }

  private List<String> messages(UUID rideId, UUID memberId, Account account) {
    String url =
        "/api/v1/rides/"
            + rideId
            + "/chat/messages"
            + (memberId == null ? "" : "?memberId=" + memberId);
    return ok(get(url, account.token()), HttpStatus.OK).get("items").findValuesAsText("body");
  }

  private OffsetDateTime closedAt(UUID rideId, UUID riderUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT closed_at FROM chat_threads WHERE ride_id = ? AND rider_user_id = ?",
        OffsetDateTime.class,
        rideId,
        riderUserId);
  }
}
