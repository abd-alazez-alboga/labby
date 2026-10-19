package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * M13-T5 acceptance — the growth walkthrough, scripted through the real HTTP API on the controlled
 * clock with the real outbox → push path (the push service captured per device token). The region's
 * growth knobs are set through the real admin region bundle (ruling 4). Three scenarios: (1) a new
 * rider registers with a friend's referral code → first completed ride credits both wallets, pushes
 * both sides, and awards {@code first_referral} exactly once even when a second friend follows; (2)
 * a promo-discounted ride: the preview, the stored breakdown on the receipt, the driver made whole
 * (commission on the pre-discount fare + {@code promo_compensation}) in the ledger, the driver's
 * earnings views and the admin's promo detail; (3) loyalty accrues, a challenge completes and
 * credits its points once, the rider redeems into a visible wallet credit and spends it on the next
 * ride. Every credit is read back from its ledger and the balance invariants close each scenario.
 */
class GrowthSimulatorIntegrationTest extends AbstractMoneyIntegrationTest {

  /** 400 points per currency unit → the 1.50 minimum fare accrues 600 points. */
  private static final long POINTS_PER_RIDE = 600;

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;

  /** Every captured push with the device tokens it went to. */
  private final List<Map.Entry<List<?>, PushMessage>> pushes = new CopyOnWriteArrayList<>();

  private final Map<UUID, String> deviceOf = new HashMap<>();
  private int devices;
  private int phones;

  @BeforeEach
  void capturePushesAndConfigureGrowth() {
    pushes.clear();
    deviceOf.clear();
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> {
              List<?> tokens = invocation.getArgument(0);
              pushes.add(Map.entry(List.copyOf(tokens), invocation.getArgument(1)));
              return new PushResult(tokens.size(), Set.of());
            });
    configureGrowthThroughRegionBundle();
  }

  /**
   * Ruling 4: the growth knobs are admin-editable on the region bundle. Round-trips the bundle
   * through the real GET → PUT (keep-on-omit for the other M11–M13 settings) and reads it back.
   */
  private void configureGrowthThroughRegionBundle() {
    ObjectNode bundle =
        ok(get("/api/v1/admin/regions/" + regionId, admin), HttpStatus.OK).deepCopy();
    bundle.remove(List.of("id", "state", "serviceTypeCount", "surgeZoneCount", "growthSettings"));
    // The SQL-seeded test region skips the mandatory M4 config an ACTIVE bundle must carry; the
    // 25% base tier matches the fixture's COMMISSION.
    bundle.putPOJO(
        "commissionTiers",
        List.of(
            Map.of("weeklyTripsAbove", 0, "percent", 25),
            Map.of("weeklyTripsAbove", 100, "percent", 20)));
    bundle.putPOJO(
        "incentiveValues",
        Map.of(
            "weeklyTripBonuses",
            List.of(Map.of("trips", 40, "amount", 50)),
            "peakHourBonusPerTrip",
            1.0,
            "ratingReward",
            Map.of("amount", 20, "minAvgRating", 4.8, "minWeeklyTrips", 30),
            "peakWindows",
            List.of(
                Map.of(
                    "daysOfWeek", List.of(1, 2, 3, 4), "startsAt", "07:00", "endsAt", "09:30"))));
    bundle.putPOJO(
        "suspensionThresholds",
        Map.of(
            "driver", Map.of("minAvgRating", 3.0, "minRatedRides", 20),
            "rider", Map.of("minAvgRating", 2.5, "minRatedRides", 10)));
    Map<String, Object> growth = new LinkedHashMap<>();
    growth.put("referralReferrerAmount", "3.00");
    growth.put("referralRefereeAmount", "2.00");
    growth.put("pointsPerCurrencyUnit", 400);
    growth.put("redemptionThresholdPoints", 100);
    growth.put("redemptionRate", "0.5");
    bundle.putPOJO("growthSettings", growth);
    JsonNode saved = ok(put("/api/v1/admin/regions/" + regionId, bundle, admin), HttpStatus.OK);
    assertThat(saved.get("growthSettings").get("referralRefereeAmount").decimalValue())
        .isEqualByComparingTo("2.00");
    JsonNode reread = ok(get("/api/v1/admin/regions/" + regionId, admin), HttpStatus.OK);
    assertThat(reread.get("growthSettings").get("pointsPerCurrencyUnit").decimalValue())
        .isEqualByComparingTo("400");
    assertThat(reread.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
  }

  // ---- 1. referral: register with a code -> first ride pays both -> badge once -----------------

  @Test
  @DisplayName(
      "GRW-03 + GAME-01: register with a referral code → first completed ride credits both"
          + " wallets, pushes both, first_referral once; a second friend pays again, no re-award")
  void shouldRewardReferralOnFirstRideAndAwardBadgeOnce() {
    Account referrer = rider();
    registerDevice(referrer, "rider");
    JsonNode share =
        ok(get("/api/v1/referrals/me?regionId=" + regionId, referrer.token()), HttpStatus.OK);
    String code = share.get("code").asText();
    assertThat(share.get("reward").get("refereeAmount").decimalValue())
        .isEqualByComparingTo("2.00");

    // The friend registers through the real auth flow with the code on the register step.
    Account referee = registerWithReferralCode("Rama Referee", code);
    registerDevice(referee, "rider");
    assertThat(
            ok(get("/api/v1/referrals/me", referee.token()), HttpStatus.OK)
                .get("enteredCode")
                .asText())
        .isEqualTo(code);
    JsonNode pending = ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK);
    assertThat(pending.get("referees")).hasSize(1);
    assertThat(pending.get("referees").get(0).get("status").asText()).isEqualTo("pending");
    assertThat(walletBalance(referrer.userId())).isEqualByComparingTo("0");

    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    finishCash(driver, book(referee));

    // Both wallets, the exact region amounts, typed `referral`, visible to the rider and the admin.
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("3.00");
    assertThat(walletCredit(referee.userId(), "referral")).isEqualByComparingTo("2.00");
    JsonNode refereeWallet = ok(get("/api/v1/wallet", referee.token()), HttpStatus.OK);
    assertThat(refereeWallet.get("balances").get(0).get("balance").decimalValue())
        .isEqualByComparingTo("2.00");
    JsonNode refereeHistory =
        ok(get("/api/v1/wallet/transactions", referee.token()), HttpStatus.OK);
    assertThat(refereeHistory.get("items").get(0).get("type").asText()).isEqualTo("referral");
    JsonNode adminHistory =
        ok(
            get("/api/v1/admin/users/" + referrer.userId() + "/wallet/transactions", admin),
            HttpStatus.OK);
    assertThat(adminHistory.get("items").get(0).get("type").asText()).isEqualTo("referral");
    assertThat(adminHistory.get("items").get(0).get("amount").decimalValue())
        .isEqualByComparingTo("3.00");
    assertThat(referralStatus(referee.userId())).isEqualTo("rewarded");

    // Pushes reach both devices; the referrer also hears about the badge.
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(referrer)).contains("growth.referral_rewarded", "growth.badge_awarded");
    assertThat(pushedEvents(referee)).contains("growth.referral_rewarded");
    assertThat(badgeCount(referrer.userId(), "first_referral")).isEqualTo(1);
    JsonNode badges =
        ok(get("/api/v1/gamification/me?as=rider", referrer.token()), HttpStatus.OK).get("badges");
    assertThat(
            badges.findParents("badgeCode").stream()
                .filter(badge -> "first_referral".equals(badge.get("badgeCode").asText()))
                .findFirst()
                .orElseThrow()
                .get("earned")
                .asBoolean())
        .isTrue();

    // A second friend: paid again, the badge is not re-awarded, nothing re-pushed for it.
    Account second = registerWithReferralCode("Khaled Second", code);
    finishCash(driver, book(second));
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("6.00");
    assertThat(walletCredit(second.userId(), "referral")).isEqualByComparingTo("2.00");
    assertThat(badgeCount(referrer.userId(), "first_referral")).isEqualTo(1);
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(referrer).stream().filter("growth.badge_awarded"::equals)).hasSize(1);

    // The first referee's second ride pays nothing more (exactly once).
    finishCash(driver, book(referee));
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("6.00");
    assertThat(walletCredit(referee.userId(), "referral")).isEqualByComparingTo("2.00");
    JsonNode status = ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK);
    assertThat(status.get("referees")).hasSize(2);
    assertThat(status.get("referees").findValuesAsText("status")).containsOnly("rewarded");
    assertLedgerInvariants();
  }

  // ---- 2. promo: preview -> discounted breakdown -> driver made whole -> admin trace ---------

  @Test
  @DisplayName(
      "GRW-01/02 + ruling 1: promo preview → stored discounted breakdown on the receipt → driver"
          + " made whole in ledger, earnings and admin views")
  void shouldShowDiscountedBreakdownAndMakeDriverWhole() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID promoId = adminPromo(promoBody("WELCOME10", "percent", "10"));

    JsonNode preview =
        ok(
            post(
                "/api/v1/promos/validate",
                Map.of(
                    "code",
                    "WELCOME10",
                    "regionId",
                    regionId.toString(),
                    "serviceTypeId",
                    economy.toString(),
                    "estimateTotal",
                    "1.50"),
                rider.token()),
            HttpStatus.OK);
    assertThat(preview.get("discountPreview").decimalValue()).isEqualByComparingTo("0.15");

    UUID rideId = finishCash(driver, bookWith(rider, "WELCOME10"));

    // The receipt shows the STORED breakdown: discount last, never recomputed.
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    JsonNode components = receipt.get("fare").get("components");
    assertThat(components.get("discount").decimalValue()).isEqualByComparingTo("0.15");
    assertThat(components.get("total").decimalValue()).isEqualByComparingTo("1.35");
    assertThat(receipt.get("paymentStatus").asText()).isEqualTo("paid_cash");
    assertThat(fareColumn(rideId, "discount")).isEqualByComparingTo("0.15");
    assertThat(fareColumn(rideId, "total")).isEqualByComparingTo("1.35");

    // Ruling 1 in the driver ledger: commission on the pre-discount fare + the compensation.
    List<Map<String, Object>> entries = driverLedger(driver.userId());
    assertThat(entries).hasSize(2);
    Map<String, Object> commission =
        entries.stream()
            .filter(entry -> entry.get("type").equals("commission_due"))
            .findFirst()
            .orElseThrow();
    assertThat((BigDecimal) commission.get("fare_amount")).isEqualByComparingTo("1.50");
    assertThat((BigDecimal) commission.get("amount")).isEqualByComparingTo(COMMISSION.negate());
    Map<String, Object> compensation =
        entries.stream()
            .filter(entry -> entry.get("type").equals("promo_compensation"))
            .findFirst()
            .orElseThrow();
    assertThat((BigDecimal) compensation.get("amount")).isEqualByComparingTo("0.15");
    assertThat(compensation.get("ride_id")).isEqualTo(rideId);
    // The driver's position equals the same ride without the promo: −0.38 + 0.15.
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("-0.23");

    // The driver's own views carry the compensation (M13-T5 amendment of money-v1).
    JsonNode trip =
        ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK).get("items").get(0);
    assertThat(trip.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(trip.get("fareTotal").decimalValue()).isEqualByComparingTo("1.50");
    assertThat(trip.get("promoCompensation").decimalValue()).isEqualByComparingTo("0.15");
    assertThat(trip.get("net").decimalValue()).isEqualByComparingTo("-0.23");
    JsonNode summary =
        ok(get("/api/v1/driver/earnings/summary?period=weekly", driver.token()), HttpStatus.OK);
    assertThat(summary.get("fares").decimalValue()).isEqualByComparingTo("1.50");
    assertThat(summary.get("net").decimalValue()).isEqualByComparingTo("-0.23");

    // Admin traceability: the redemption on the promo, the typed entry in the driver ledger.
    JsonNode detail = ok(get("/api/v1/admin/promos/" + promoId, admin), HttpStatus.OK);
    assertThat(detail.get("promo").get("redemptionCount").asInt()).isEqualTo(1);
    JsonNode redemption = detail.get("redemptions").get("items").get(0);
    assertThat(redemption.get("rideId").asText()).isEqualTo(rideId.toString());
    assertThat(redemption.get("userId").asText()).isEqualTo(rider.userId().toString());
    assertThat(redemption.get("amount").decimalValue()).isEqualByComparingTo("0.15");
    JsonNode ledger =
        ok(get("/api/v1/admin/drivers/" + driver.userId() + "/ledger", admin), HttpStatus.OK);
    assertThat(ledger.get("entries").findValuesAsText("type"))
        .contains("promo_compensation", "commission_due");
    assertLedgerInvariants();
  }

  // ---- 3. loyalty accrues -> challenge completes -> redeem -> spend on the next ride ----------

  @Test
  @DisplayName(
      "GRW-04 + GAME-02/03: points accrue, a challenge credits once, redemption lands as a visible"
          + " wallet credit spent on the next ride; lifetime and level unmoved by spending")
  void shouldAccrueCompleteChallengeRedeemAndSpend() {
    Account rider = rider();
    registerDevice(rider, "rider");
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Instant start = CLOCK.instant().minus(Duration.ofMinutes(1));
    UUID challengeId =
        adminChallenge("rider", "completed_rides", 2, 150, start, start.plus(Duration.ofDays(1)));

    finishCash(driver, book(rider));
    JsonNode afterOne =
        ok(get("/api/v1/loyalty?regionId=" + regionId, rider.token()), HttpStatus.OK);
    assertThat(afterOne.get("redeemable").asLong()).isEqualTo(POINTS_PER_RIDE);
    assertThat(afterOne.get("lifetime").asLong()).isEqualTo(POINTS_PER_RIDE);
    assertThat(afterOne.get("level").asText()).isEqualTo("silver");
    JsonNode running = myChallenge(rider, challengeId);
    assertThat(running.get("myProgress").asInt()).isEqualTo(1);
    assertThat(running.get("myCompleted").asBoolean()).isFalse();

    // The second ride completes the challenge: +150 exactly once, pushed once, admin sees it.
    finishCash(driver, book(rider));
    assertThat(pointsOfType(rider.userId(), "challenge")).isEqualTo(150);
    assertThat(pointsRows(rider.userId(), "challenge")).isEqualTo(1);
    JsonNode done = myChallenge(rider, challengeId);
    assertThat(done.get("myProgress").asInt()).isEqualTo(2);
    assertThat(done.get("myCompleted").asBoolean()).isTrue();
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(rider).stream().filter("growth.challenge_completed"::equals))
        .hasSize(1);
    JsonNode adminDetail = ok(get("/api/v1/admin/challenges/" + challengeId, admin), HttpStatus.OK);
    assertThat(adminDetail.get("challenge").get("completedCount").asLong()).isEqualTo(1);
    long lifetimeBefore = 2 * POINTS_PER_RIDE + 150;
    JsonNode afterTwo =
        ok(get("/api/v1/loyalty?regionId=" + regionId, rider.token()), HttpStatus.OK);
    assertThat(afterTwo.get("redeemable").asLong()).isEqualTo(lifetimeBefore);
    assertThat(afterTwo.get("lifetime").asLong()).isEqualTo(lifetimeBefore);

    // Redeem 500 → 250.00 wallet credit, visible in the rider's wallet and linked from the points.
    JsonNode redeemed =
        ok(
            post(
                "/api/v1/loyalty/redeem",
                Map.of("regionId", regionId.toString(), "points", 500),
                rider.token()),
            HttpStatus.OK);
    assertThat(redeemed.get("redeemable").asLong()).isEqualTo(lifetimeBefore - 500);
    assertThat(redeemed.get("lifetime").asLong()).isEqualTo(lifetimeBefore);
    assertThat(redeemed.get("level").asText()).isEqualTo("silver");
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("250.00");
    JsonNode wallet = ok(get("/api/v1/wallet", rider.token()), HttpStatus.OK);
    assertThat(wallet.get("balances").get(0).get("balance").decimalValue())
        .isEqualByComparingTo("250.00");
    JsonNode history = ok(get("/api/v1/wallet/transactions", rider.token()), HttpStatus.OK);
    assertThat(history.get("items").get(0).get("type").asText()).isEqualTo("loyalty_redemption");
    assertThat(history.get("items").get(0).get("amount").decimalValue())
        .isEqualByComparingTo("250.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM points_transactions t JOIN wallet_transactions w ON"
                    + " w.wallet_transaction_id = t.wallet_transaction_id WHERE t.user_id = ? AND"
                    + " t.type = 'redemption' AND t.points = -500 AND w.type ="
                    + " 'loyalty_redemption' AND w.amount = 250.00",
                Integer.class,
                rider.userId()))
        .isEqualTo(1);

    // The credit pays the next ride from the wallet.
    JsonNode walletRide = ok(tryBook(rider, booking("wallet")), HttpStatus.CREATED);
    UUID paidRide = UUID.fromString(walletRide.get("id").asText());
    dispatchAndAccept(paidRide, driver);
    arriveAndStart(paidRide, driver);
    ok(driverAction(driver, paidRide, "complete"), HttpStatus.OK);
    JsonNode receipt =
        ok(get("/api/v1/rides/" + paidRide + "/receipt", rider.token()), HttpStatus.OK);
    assertThat(receipt.get("paymentStatus").asText()).isEqualTo("paid_wallet");
    assertThat(receipt.get("walletApplied").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(walletBalance(rider.userId())).isEqualByComparingTo("248.50");
    JsonNode spent = ok(get("/api/v1/wallet/transactions", rider.token()), HttpStatus.OK);
    assertThat(spent.get("items").get(0).get("type").asText()).isEqualTo("fare_payment");
    assertThat(spent.get("items").get(0).get("amount").decimalValue())
        .isEqualByComparingTo(FARE.negate());
    assertThat(spent.get("items").get(0).get("rideId").asText()).isEqualTo(paidRide.toString());

    // Spending never moved the lifetime; the wallet ride accrued like any other; still silver.
    JsonNode afterSpend =
        ok(get("/api/v1/loyalty?regionId=" + regionId, rider.token()), HttpStatus.OK);
    assertThat(afterSpend.get("lifetime").asLong()).isEqualTo(lifetimeBefore + POINTS_PER_RIDE);
    assertThat(afterSpend.get("redeemable").asLong())
        .isEqualTo(lifetimeBefore - 500 + POINTS_PER_RIDE);
    assertThat(afterSpend.get("level").asText()).isEqualTo("silver");
    // A third ride recounts nothing on the finished challenge.
    assertThat(pointsRows(rider.userId(), "challenge")).isEqualTo(1);
    assertLedgerInvariants();
  }

  // ---- helpers -------------------------------------------------------------------------------

  /** The real register flow (start → verify → complete) with the friend's code on the last step. */
  private Account registerWithReferralCode(String name, String referralCode) {
    String phone = "+96393110" + String.format("%04d", ++phones);
    assertThat(
            restTemplate
                .postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    ResponseEntity<JsonNode> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            JsonNode.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    Map<String, Object> complete = new LinkedHashMap<>();
    complete.put("registrationToken", verify.getBody().get("registrationToken").asText());
    complete.put("password", "Secret123!");
    complete.put("name", name);
    complete.put("termsAccepted", true);
    complete.put("referralCode", referralCode);
    ResponseEntity<JsonNode> session =
        restTemplate.postForEntity("/api/v1/auth/register/complete", complete, JsonNode.class);
    assertThat(session.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return new Account(
        UUID.fromString(session.getBody().get("user").get("id").asText()),
        session.getBody().get("accessToken").asText(),
        phone);
  }

  private UUID bookWith(Account rider, String promoCode) {
    Map<String, Object> body = booking(List.of());
    body.put("promoCode", promoCode);
    return UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
  }

  /** Runs a booked cash ride to its confirmed completion. */
  private UUID finishCash(Account driver, UUID rideId) {
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    return rideId;
  }

  private Map<String, Object> promoBody(String code, String type, String value) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", code);
    body.put("type", type);
    body.put("value", value);
    body.put("startsAt", CLOCK.instant().minus(Duration.ofHours(1)).toString());
    body.put("endsAt", CLOCK.instant().plus(Duration.ofDays(30)).toString());
    return body;
  }

  private UUID adminPromo(Map<String, Object> body) {
    return UUID.fromString(
        ok(post("/api/v1/admin/promos", body, admin), HttpStatus.CREATED).get("promoId").asText());
  }

  private UUID adminChallenge(
      String role, String goalType, int target, long reward, Instant startsAt, Instant endsAt) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("regionId", regionId.toString());
    body.put("role", role);
    body.put("titleEn", "Two rides today");
    body.put("titleAr", "رحلتان اليوم");
    body.put("goalType", goalType);
    body.put("goalTarget", target);
    body.put("rewardPoints", reward);
    body.put("startsAt", startsAt.toString());
    body.put("endsAt", endsAt.toString());
    return UUID.fromString(
        ok(post("/api/v1/admin/challenges", body, admin), HttpStatus.CREATED)
            .get("challengeId")
            .asText());
  }

  /** The rider's view of one challenge from the live list. */
  private JsonNode myChallenge(Account rider, UUID challengeId) {
    JsonNode list =
        ok(
            get("/api/v1/challenges?regionId=" + regionId + "&as=rider", rider.token()),
            HttpStatus.OK);
    for (JsonNode challenge : list) {
      if (challengeId.toString().equals(challenge.get("challengeId").asText())) {
        return challenge;
      }
    }
    throw new AssertionError("challenge " + challengeId + " missing from the rider's list");
  }

  private BigDecimal fareColumn(UUID rideId, String column) {
    return jdbcTemplate.queryForObject(
        "SELECT " + column + " FROM fares WHERE ride_id = ?", BigDecimal.class, rideId);
  }

  private BigDecimal walletCredit(UUID userId, String type) {
    return jdbcTemplate.queryForObject(
        "SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE user_id = ? AND type ="
            + " ?",
        BigDecimal.class,
        userId,
        type);
  }

  private String referralStatus(UUID refereeUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT status FROM referrals WHERE referee_user_id = ?", String.class, refereeUserId);
  }

  private int badgeCount(UUID userId, String badge) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM user_badges WHERE user_id = ? AND badge_code = ?",
        Integer.class,
        userId,
        badge);
  }

  private long pointsOfType(UUID userId, String type) {
    return jdbcTemplate.queryForObject(
        "SELECT COALESCE(SUM(points), 0) FROM points_transactions WHERE user_id = ? AND type = ?",
        Long.class,
        userId,
        type);
  }

  private int pointsRows(UUID userId, String type) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM points_transactions WHERE user_id = ? AND type = ?",
        Integer.class,
        userId,
        type);
  }

  private void registerDevice(Account account, String app) {
    String token = "fcm-m13-" + (++devices);
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", token, "platform", "android", "app", app), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    deviceOf.put(account.userId(), token);
  }

  /** The events pushed to one account's device, in order. */
  private List<String> pushedEvents(Account account) {
    String token = deviceOf.get(account.userId());
    return pushes.stream()
        .filter(push -> push.getKey().contains(token))
        .map(push -> push.getValue().data().get("event"))
        .toList();
  }
}
