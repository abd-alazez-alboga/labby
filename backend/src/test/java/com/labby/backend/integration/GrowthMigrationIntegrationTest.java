package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M13-T1 acceptance: V24 migrates cleanly and the growth invariants hold at the DATABASE level —
 * promo shapes (code, window, percent/fixed, caps) and one redemption per ride ever (GRW-01/02);
 * referral uniqueness per referee account AND per phone number ever, no self-referral, a rewarded
 * row carries its ride and moment (GRW-03, owner ruling 2026-10-18); points accounts never go
 * negative and every points transaction is typed, signed and linked to its source (GRW-04); the
 * badge catalog is seeded and awarding is exactly-once (GAME-01); challenge shapes hold and a
 * progress row credits at most once, only after completion (GAME-02); region growth settings are an
 * object.
 */
class GrowthMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID admin;
  private UUID rider;
  private UUID referee;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Growth IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    admin = newUser();
    rider = newUser();
    referee = newUser();
  }

  @AfterEach
  void cleanOwnRows() {
    jdbcTemplate.execute(
        "TRUNCATE promo_redemptions, promos, referrals, referral_codes, challenge_progress,"
            + " challenges, points_transactions, points_accounts, user_badges,"
            + " wallet_transactions, incentive_awards, driver_ledger, settlements");
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("GRW-01: promo codes are uppercase, unique, windowed; fixed promos are region-bound")
  void shouldEnforcePromoShape() {
    UUID promo = insertPromo("WELCOME10", "percent", "10.00", null);
    assertThatThrownBy(() -> insertPromo("WELCOME10", "percent", "5.00", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_promos_code");
    assertThatThrownBy(() -> insertPromo("welcome11", "percent", "5.00", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promos_code");
    assertThatThrownBy(() -> insertPromo("OVER", "percent", "101.00", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promos_percent");
    // A fixed amount is in a currency, so it must be bound to a region (contract ruling 1).
    assertThatThrownBy(() -> insertPromo("FIXED5", "fixed", "5000.00", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promos_fixed_region");
    insertPromo("FIXED5", "fixed", "5000.00", regionId);
    // The window must be ordered; limits must be positive.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE promos SET ends_at = starts_at WHERE promo_id = ?", promo))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promos_window");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE promos SET per_user_limit = 0 WHERE promo_id = ?", promo))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promos_per_user_limit");
  }

  @Test
  @DisplayName("GRW-02: one promo redemption per ride, ever — the DB-level redemption backstop")
  void shouldRedeemAtMostOncePerRide() {
    UUID promo = insertPromo("ONCE", "percent", "10.00", null);
    UUID other = insertPromo("TWICE", "percent", "20.00", null);
    UUID ride = insertRide(rider);
    insertRedemption(promo, rider, ride);
    // Not twice for the same promo, and not once more through a different promo (no stacking).
    assertThatThrownBy(() -> insertRedemption(promo, rider, ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_promo_redemptions_ride");
    assertThatThrownBy(() -> insertRedemption(other, rider, ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_promo_redemptions_ride");
    UUID otherRide = insertRide(referee);
    assertThatThrownBy(() -> insertRedemptionAmount(other, referee, otherRide, "0.00"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_promo_redemptions_amount");
  }

  @Test
  @DisplayName("GRW-03: one share code per user; a referee — and a phone — is rewarded once ever")
  void shouldEnforceReferralUniqueness() {
    jdbcTemplate.update("INSERT INTO referral_codes (user_id, code) VALUES (?, 'LABBY1')", rider);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO referral_codes (user_id, code) VALUES (?, 'LABBY2')", rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("referral_codes_pkey");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO referral_codes (user_id, code) VALUES (?, 'LABBY1')", referee))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_referral_codes_code");

    insertReferral(rider, referee, "+963700000001");
    // Owner ruling 2026-10-18: once per referee account and once per phone number, EVER.
    assertThatThrownBy(() -> insertReferral(admin, referee, "+963700000002"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_referrals_referee");
    assertThatThrownBy(() -> insertReferral(admin, newUser(), "+963700000001"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_referrals_referee_phone");
    assertThatThrownBy(() -> insertReferral(rider, rider, "+963700000003"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_referrals_not_self");
    // Rewarded rows carry the ride and the moment, pending rows neither.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE referrals SET status = 'rewarded' WHERE referee_user_id = ?", referee))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_referrals_rewarded");
    jdbcTemplate.update(
        "UPDATE referrals SET status = 'rewarded', rewarded_ride_id = ?, rewarded_at = now()"
            + " WHERE referee_user_id = ?",
        insertRide(referee),
        referee);
  }

  @Test
  @DisplayName("GRW-04: points never go negative; every transaction is typed, signed and linked")
  void shouldEnforcePointsShape() {
    jdbcTemplate.update(
        "INSERT INTO points_accounts (user_id, redeemable, lifetime) VALUES (?, 100, 100)", rider);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE points_accounts SET redeemable = -1 WHERE user_id = ?", rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_points_accounts_redeemable");
    // An accrual names its ride and is positive.
    UUID ride = insertRide(rider);
    insertPoints(rider, "accrual", 100, ride, null);
    assertThatThrownBy(() -> insertPoints(rider, "accrual", 100, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_points_transactions_refs");
    assertThatThrownBy(() -> insertPoints(rider, "accrual", -100, ride, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_points_transactions_sign");
    // A redemption is negative and traceable to its wallet credit (milestone AC).
    assertThatThrownBy(() -> insertPoints(rider, "redemption", -100, null, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_points_transactions_refs");
    insertPoints(rider, "redemption", -100, null, insertRedemptionCredit(rider));
  }

  @Test
  @DisplayName("GAME-01: the fixed badge catalog is seeded; awarding is exactly-once")
  void shouldAwardBadgesExactlyOnce() {
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT badge_code FROM badges ORDER BY sort_order", String.class))
        .containsExactly(
            "ride_10",
            "ride_50",
            "ride_100",
            "first_shared_ride",
            "first_referral",
            "five_star_week");
    jdbcTemplate.update(
        "INSERT INTO user_badges (user_id, badge_code) VALUES (?, 'ride_10')", rider);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO user_badges (user_id, badge_code) VALUES (?, 'ride_10')", rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("user_badges_pkey");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO user_badges (user_id, badge_code) VALUES (?, 'ride_1000')", rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("user_badges_badge_code_fkey");
  }

  @Test
  @DisplayName("GAME-02: challenge shapes hold; a progress row credits once, after completion")
  void shouldEnforceChallengeShape() {
    UUID challenge = insertChallenge();
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE challenges SET role = 'admin' WHERE challenge_id = ?", challenge))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_challenges_role");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE challenges SET goal_target = 0 WHERE challenge_id = ?", challenge))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_challenges_goal_target");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE challenges SET ends_at = starts_at WHERE challenge_id = ?", challenge))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_challenges_window");

    jdbcTemplate.update(
        "INSERT INTO challenge_progress (challenge_id, user_id, progress) VALUES (?, ?, 1)",
        challenge,
        rider);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO challenge_progress (challenge_id, user_id, progress) VALUES"
                        + " (?, ?, 2)",
                    challenge,
                    rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("challenge_progress_pkey");
    // The reward credit needs the completion first, and one credit serves one progress row.
    UUID credit = insertChallengePoints(rider, challenge);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE challenge_progress SET points_transaction_id = ? WHERE challenge_id"
                        + " = ? AND user_id = ?",
                    credit,
                    challenge,
                    rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_challenge_progress_credit");
    jdbcTemplate.update(
        "UPDATE challenge_progress SET completed_at = now(), points_transaction_id = ? WHERE"
            + " challenge_id = ? AND user_id = ?",
        credit,
        challenge,
        rider);
    jdbcTemplate.update(
        "INSERT INTO challenge_progress (challenge_id, user_id, progress, completed_at) VALUES"
            + " (?, ?, 3, now())",
        challenge,
        referee);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE challenge_progress SET points_transaction_id = ? WHERE challenge_id"
                        + " = ? AND user_id = ?",
                    credit,
                    challenge,
                    referee))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_challenge_progress_credit");
  }

  @Test
  @DisplayName("Ruling 4: region growth settings default to NULL and must be an object")
  void shouldValidateRegionGrowthSettings() {
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT growth_settings IS NULL FROM regions WHERE region_id = ?",
                Boolean.class,
                regionId))
        .isTrue();
    jdbcTemplate.update(
        "UPDATE regions SET growth_settings = '{\"pointsPerCurrencyUnit\": 1}' WHERE region_id"
            + " = ?",
        regionId);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE regions SET growth_settings = '[1]' WHERE region_id = ?", regionId))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_regions_growth_settings");
  }

  private UUID insertPromo(String code, String type, String value, UUID region) {
    UUID promoId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO promos (promo_id, code, region_id, type, value, starts_at, ends_at,"
            + " created_by) VALUES (?, ?, ?, ?, ?::numeric, now(), now() + interval '30 days', ?)",
        promoId,
        code,
        region,
        type,
        value,
        admin);
    return promoId;
  }

  private void insertRedemption(UUID promoId, UUID userId, UUID rideId) {
    insertRedemptionAmount(promoId, userId, rideId, "500.00");
  }

  private void insertRedemptionAmount(UUID promoId, UUID userId, UUID rideId, String amount) {
    jdbcTemplate.update(
        "INSERT INTO promo_redemptions (promo_id, user_id, ride_id, amount, currency) VALUES"
            + " (?, ?, ?, ?::numeric, 'SYP')",
        promoId,
        userId,
        rideId,
        amount);
  }

  private void insertReferral(UUID referrer, UUID refereeId, String phone) {
    jdbcTemplate.update(
        "INSERT INTO referrals (referrer_user_id, referee_user_id, referee_phone) VALUES"
            + " (?, ?, ?)",
        referrer,
        refereeId,
        phone);
  }

  private void insertPoints(UUID userId, String type, long points, UUID rideId, UUID walletTxId) {
    jdbcTemplate.update(
        "INSERT INTO points_transactions (user_id, type, points, ride_id, wallet_transaction_id)"
            + " VALUES (?, ?, ?, ?, ?)",
        userId,
        type,
        points,
        rideId,
        walletTxId);
  }

  private UUID insertChallengePoints(UUID userId, UUID challengeId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO points_transactions (points_transaction_id, user_id, type, points,"
            + " challenge_id) VALUES (?, ?, 'challenge', 50, ?)",
        id,
        userId,
        challengeId);
    return id;
  }

  private UUID insertRedemptionCredit(UUID userId) {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO wallet_transactions (wallet_transaction_id, user_id, currency, amount, type,"
            + " balance_after) VALUES (?, ?, 'SYP', 100.00, 'loyalty_redemption', 100.00)",
        id,
        userId);
    return id;
  }

  private UUID insertChallenge() {
    UUID id = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO challenges (challenge_id, region_id, role, title_en, title_ar, goal_type,"
            + " goal_target, reward_points, starts_at, ends_at, created_by) VALUES (?, ?, 'rider',"
            + " 'Ten rides', 'عشر رحلات', 'completed_rides', 10, 500, now(), now() + interval"
            + " '14 days', ?)",
        id,
        regionId,
        admin);
    return id;
  }

  private UUID insertRide(UUID riderId) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, kind, state,"
            + " pickup, destination, payment_method, pickup_distance_mode, currency,"
            + " estimate_total, estimate_distance_m, estimate_duration_s, estimate_components)"
            + " VALUES (?, ?, ?, ?, 'on_demand', 'requested',"
            + " ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP',"
            + " 3000.00, 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Growth Test User', now())",
        userId,
        "+9637%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
