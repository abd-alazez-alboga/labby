package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.RatingSnapshotJob;
import java.time.Duration;
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
 * V1 conformance audit (2026-10-20) growth fixes: I19 (a retry re-checks the promo cap and the
 * per-user limit), I20 (a reactivated deleted account is not a new user for referrals), I21 (growth
 * freezes on a ROLE suspension too) and I22 (the five-star week is any rolling 7 days).
 */
class GrowthAuditFixesIntegrationTest extends AbstractRideIntegrationTest {

  @Autowired private RatingSnapshotJob ratingSnapshotJob;

  @Test
  @DisplayName("I19: a retry drops the promo when another rider took the freed cap meanwhile")
  void shouldRecheckPromoCapOnRetry() {
    Map<String, Object> capped = promoBody("RETRYCAP");
    capped.put("totalCap", 1);
    ok(post("/api/v1/admin/promos", capped, admin), HttpStatus.CREATED);
    Account first = rider();
    UUID failed = bookWith(first, "RETRYCAP");
    dispatch(); // no driver online → no_driver_found; the reservation stops counting
    assertThat(stateOf(failed)).isEqualTo("no_driver_found");

    Account second = rider();
    bookWith(second, "RETRYCAP"); // takes the freed slot

    JsonNode retried =
        ok(post("/api/v1/rides/" + failed + "/retry", null, first.token()), HttpStatus.CREATED);
    UUID retriedId = UUID.fromString(retried.get("id").asText());
    assertThat(redemptions(retriedId)).isZero();
  }

  @Test
  @DisplayName("I19: a retry keeps the promo while it still fits the cap")
  void shouldCarryPromoOnRetryWhileItFits() {
    Map<String, Object> capped = promoBody("RETRYOK");
    capped.put("totalCap", 1);
    ok(post("/api/v1/admin/promos", capped, admin), HttpStatus.CREATED);
    Account rider = rider();
    UUID failed = bookWith(rider, "RETRYOK");
    dispatch();
    JsonNode retried =
        ok(post("/api/v1/rides/" + failed + "/retry", null, rider.token()), HttpStatus.CREATED);
    assertThat(redemptions(UUID.fromString(retried.get("id").asText()))).isEqualTo(1);
  }

  @Test
  @DisplayName("I20: a reactivated deleted account cannot enter a referral code")
  void shouldRefuseReferralForReactivatedAccount() {
    Account referrer = rider();
    Account returning = rider();
    String code =
        ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK).get("code").asText();
    // Deleted, then reactivated by re-registration (USR-07): the database stamps the moment.
    jdbcTemplate.update(
        "UPDATE users SET state = 'deleted', deleted_at = now() WHERE user_id = ?",
        returning.userId());
    jdbcTemplate.update(
        "UPDATE users SET state = 'active', deleted_at = NULL WHERE user_id = ?",
        returning.userId());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT reactivated_at IS NOT NULL FROM users WHERE user_id = ?",
                Boolean.class,
                returning.userId()))
        .isTrue();

    ResponseEntity<JsonNode> refused =
        post("/api/v1/referrals/enter", Map.of("code", code), returning.token());
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(refused)).isEqualTo("referral_not_new_user");
    // A never-deleted new account still can.
    ok(post("/api/v1/referrals/enter", Map.of("code", code), rider().token()), HttpStatus.OK);
  }

  @Test
  @DisplayName("I21: a rider ROLE suspension freezes accrual and redemption")
  void shouldFreezeGrowthOnRoleSuspension() {
    jdbcTemplate.update(
        "UPDATE regions SET growth_settings = ?::jsonb WHERE region_id = ?",
        "{\"referralReferrerAmount\": 0, \"referralRefereeAmount\": 0,"
            + " \"pointsPerCurrencyUnit\": 400, \"redemptionThresholdPoints\": 1,"
            + " \"redemptionRate\": 0.5}",
        regionId);
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended' WHERE user_id = ? AND role = 'rider'",
        rider.userId());
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM points_transactions WHERE user_id = ?",
                Integer.class,
                rider.userId()))
        .isZero();
    // Points kept elsewhere would still be frozen: redemption is refused.
    jdbcTemplate.update(
        "INSERT INTO points_accounts (user_id, redeemable, lifetime) VALUES (?, 100, 100)",
        rider.userId());
    ResponseEntity<JsonNode> redeem =
        post(
            "/api/v1/loyalty/redeem",
            Map.of("regionId", regionId.toString(), "points", 10),
            rider.token());
    assertThat(redeem.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(code(redeem)).isEqualTo("account_suspended");
  }

  @Test
  @DisplayName("I22: three 5★ ratings after a 4★ in the same 7 days still make a 5-star week")
  void shouldFindAnyRollingFiveStarWeek() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    for (int score : new int[] {4, 5, 5, 5}) {
      UUID rideId = finish(driver, book(rider));
      rate(rider, rideId, score);
      advance(Duration.ofHours(1));
      position(driver, PICKUP_LAT, PICKUP_LNG); // a fresh fix for the next dispatch
    }
    // The 7 days ending at the last rating hold the 4★, but the window from the first 5★ on
    // holds three 5★ ratings only. V1 conformance H5: the nightly pass evaluates it.
    ratingSnapshotJob.run();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM user_badges WHERE user_id = ? AND badge_code ="
                    + " 'five_star_week')",
                Boolean.class,
                driver.userId()))
        .isTrue();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private Map<String, Object> promoBody(String code) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", code);
    body.put("type", "percent");
    body.put("value", "10");
    body.put("startsAt", CLOCK.instant().minus(Duration.ofHours(1)).toString());
    body.put("endsAt", CLOCK.instant().plus(Duration.ofDays(30)).toString());
    return body;
  }

  private UUID bookWith(Account rider, String promoCode) {
    Map<String, Object> body = booking(List.of());
    body.put("promoCode", promoCode);
    return UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
  }

  private int redemptions(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM promo_redemptions WHERE ride_id = ?", Integer.class, rideId);
  }

  private UUID finish(Account driver, UUID rideId) {
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    return rideId;
  }

  private void rate(Account rater, UUID rideId, int score) {
    assertThat(
            post("/api/v1/rides/" + rideId + "/rating", Map.of("score", score), rater.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }
}
