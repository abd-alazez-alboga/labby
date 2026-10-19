package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M13-T2 Phase 2 (growth-v1.yaml; GAME-01..03) on the controlled clock: ride badges and the 5-star
 * week fire exactly once; challenge progress respects the window edges, credits its reward exactly
 * once, and an early end keeps completions already made; levels derive from lifetime (drivers:
 * trips + challenge points).
 */
class GrowthGamificationIntegrationTest extends AbstractRideIntegrationTest {

  @Test
  @DisplayName("GAME-01: the 10th ride awards ride_10 to rider and driver, exactly once")
  void shouldAwardRideBadgesExactlyOnce() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    for (int i = 0; i < 10; i++) {
      finish(driver, book(rider));
    }
    for (UUID userId : List.of(rider.userId(), driver.userId())) {
      assertThat(
              jdbcTemplate.queryForObject(
                  "SELECT count(*) FROM user_badges WHERE user_id = ? AND badge_code = 'ride_10'",
                  Integer.class,
                  userId))
          .isEqualTo(1);
      assertThat(
              jdbcTemplate.queryForObject(
                  "SELECT count(*) FROM notification_outbox WHERE user_id = ? AND event ="
                      + " 'growth.badge_awarded' AND params ->> 'badgeCode' = 'ride_10'",
                  Integer.class,
                  userId))
          .isEqualTo(1);
    }
    JsonNode view = ok(get("/api/v1/gamification/me?as=rider", rider.token()), HttpStatus.OK);
    JsonNode rideTen = view.get("badges").get(0); // catalog order: ride_10 first
    assertThat(rideTen.get("badgeCode").asText()).isEqualTo("ride_10");
    assertThat(rideTen.get("earned").asBoolean()).isTrue();
    assertThat(view.get("badges")).hasSize(6);
  }

  @Test
  @DisplayName("GAME-01: three 5-star ratings inside a week make a 5-star week; a 4 breaks it")
  void shouldAwardFiveStarWeek() {
    Account rider = rider();
    Account starred = driverAt(PICKUP_LAT, PICKUP_LNG);
    for (int score : new int[] {5, 5, 5}) {
      UUID rideId = finish(starred, book(rider));
      rate(rider, rideId, score);
    }
    assertThat(hasBadge(starred.userId(), "five_star_week")).isTrue();

    // The starred driver goes offline so the mixed one gets the next offers.
    ok(put("/api/v1/driver/availability", Map.of("online", false), starred.token()), HttpStatus.OK);
    Account mixed = driverAt(PICKUP_LAT, PICKUP_LNG);
    for (int score : new int[] {5, 4, 5}) {
      UUID rideId = finish(mixed, book(rider));
      rate(rider, rideId, score);
    }
    assertThat(hasBadge(mixed.userId(), "five_star_week")).isFalse();
  }

  @Test
  @DisplayName("GAME-02: progress counts only inside the window and credits exactly once")
  void shouldRespectChallengeWindowEdges() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Instant start = CLOCK.instant().plus(Duration.ofHours(1));
    UUID challengeId =
        adminChallenge("rider", "completed_rides", 2, 50, start, start.plus(Duration.ofHours(2)));

    finish(driver, book(rider)); // before the window: no progress
    assertThat(progressOf(challengeId, rider.userId())).isNull();

    CLOCK.set(start.plus(Duration.ofMinutes(1)));
    position(driver, PICKUP_LAT, PICKUP_LNG); // fresh location after the clock jump
    finish(driver, book(rider));
    assertThat(progressOf(challengeId, rider.userId())).isEqualTo(1);
    finish(driver, book(rider));
    assertThat(progressOf(challengeId, rider.userId())).isEqualTo(2);
    // Completed: +50 points exactly once, linked from the progress row; a third ride recounts
    // nothing.
    assertThat(challengePoints(rider.userId())).isEqualTo(50);
    finish(driver, book(rider));
    assertThat(progressOf(challengeId, rider.userId())).isEqualTo(2);
    assertThat(challengePoints(rider.userId())).isEqualTo(50);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ? AND event ="
                    + " 'growth.challenge_completed'",
                Integer.class,
                rider.userId()))
        .isEqualTo(1);

    JsonNode mine =
        ok(
            get("/api/v1/challenges?regionId=" + regionId + "&as=rider", rider.token()),
            HttpStatus.OK);
    assertThat(mine.get(0).get("myProgress").asInt()).isEqualTo(2);
    assertThat(mine.get(0).get("myCompleted").asBoolean()).isTrue();

    // Past the end: a fresh participant's ride counts nothing.
    CLOCK.set(start.plus(Duration.ofHours(2)).plusSeconds(1));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    Account late = rider();
    finish(driver, book(late));
    assertThat(progressOf(challengeId, late.userId())).isNull();
  }

  @Test
  @DisplayName("GAME-02: an early end stops progress; completions already made keep their reward")
  void shouldHonorEarlyEnd() {
    Account finisher = rider();
    Account other = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Instant start = CLOCK.instant().minus(Duration.ofMinutes(1));
    UUID challengeId =
        adminChallenge("rider", "completed_rides", 1, 70, start, start.plus(Duration.ofDays(1)));
    finish(driver, book(finisher));
    assertThat(challengePoints(finisher.userId())).isEqualTo(70);

    ok(post("/api/v1/admin/challenges/" + challengeId + "/end", null, admin), HttpStatus.OK);
    finish(driver, book(other));
    assertThat(progressOf(challengeId, other.userId())).isNull();
    assertThat(challengePoints(finisher.userId())).isEqualTo(70); // the reward stands
    assertThat(code(post("/api/v1/admin/challenges/" + challengeId + "/end", null, admin)))
        .isEqualTo("already_ended");

    JsonNode detail = ok(get("/api/v1/admin/challenges/" + challengeId, admin), HttpStatus.OK);
    assertThat(detail.get("challenge").get("completedCount").asLong()).isEqualTo(1);
    assertThat(detail.get("participation").get("items").get(0).get("completed").asBoolean())
        .isTrue();
  }

  @Test
  @DisplayName("GAME-03: a driver's level counts trips + challenge points")
  void shouldDeriveDriverLevels() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Instant start = CLOCK.instant().minus(Duration.ofMinutes(1));
    adminChallenge("driver", "completed_rides", 2, 500, start, start.plus(Duration.ofDays(1)));
    finish(driver, book(rider));
    finish(driver, book(rider));
    // 2 trips + the 500 challenge points = 502 lifetime → Silver (≥ 500).
    JsonNode view = ok(get("/api/v1/gamification/me?as=driver", driver.token()), HttpStatus.OK);
    assertThat(view.get("lifetime").asLong()).isEqualTo(502);
    assertThat(view.get("level").asText()).isEqualTo("silver");
    // The driver view carries the split (T4 amendment); the rider view does not.
    assertThat(view.get("driverTrips").asLong()).isEqualTo(2);
    assertThat(view.get("challengePoints").asLong()).isEqualTo(500);
    JsonNode riderView = ok(get("/api/v1/gamification/me?as=rider", rider.token()), HttpStatus.OK);
    assertThat(riderView.get("driverTrips").isNull()).isTrue();
    assertThat(riderView.get("challengePoints").isNull()).isTrue();
    // M13 fix W4: a DRIVER challenge reward is level-only — nothing becomes redeemable.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT COALESCE(redeemable, 0) FROM points_accounts WHERE user_id = ?",
                Long.class,
                driver.userId()))
        .isZero();
  }

  // ---- helpers ------------------------------------------------------------------------------

  private void rate(Account rater, UUID rideId, int score) {
    assertThat(
            post("/api/v1/rides/" + rideId + "/rating", Map.of("score", score), rater.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  private UUID finish(Account driver, UUID rideId) {
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    return rideId;
  }

  private UUID adminChallenge(
      String role, String goalType, int target, long reward, Instant startsAt, Instant endsAt) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("regionId", regionId.toString());
    body.put("role", role);
    body.put("titleEn", "Ride streak");
    body.put("titleAr", "سلسلة رحلات");
    body.put("goalType", goalType);
    body.put("goalTarget", target);
    body.put("rewardPoints", reward);
    body.put("startsAt", startsAt.toString());
    body.put("endsAt", endsAt.toString());
    ResponseEntity<JsonNode> created = post("/api/v1/admin/challenges", body, admin);
    return UUID.fromString(ok(created, HttpStatus.CREATED).get("challengeId").asText());
  }

  private Integer progressOf(UUID challengeId, UUID userId) {
    List<Integer> rows =
        jdbcTemplate.queryForList(
            "SELECT progress FROM challenge_progress WHERE challenge_id = ? AND user_id = ?",
            Integer.class,
            challengeId,
            userId);
    return rows.isEmpty() ? null : rows.get(0);
  }

  private long challengePoints(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT COALESCE(SUM(points), 0) FROM points_transactions WHERE user_id = ? AND type ="
            + " 'challenge'",
        Long.class,
        userId);
  }

  private boolean hasBadge(UUID userId, String badge) {
    return jdbcTemplate.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM user_badges WHERE user_id = ? AND badge_code = ?)",
        Boolean.class,
        userId,
        badge);
  }
}
