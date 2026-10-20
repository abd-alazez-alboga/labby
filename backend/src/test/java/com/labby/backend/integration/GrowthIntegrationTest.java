package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.ScheduledRideClockService;
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
 * M13-T2 Phase 1 (growth-v1.yaml; GRW-01..04) on the controlled clock: every promo restriction at
 * the validate endpoint AND inside booking; the stacking order (promo last, floor at zero) and the
 * ruling-1 money (commission on the pre-discount fare, promo_compensation credit); the reservation
 * released by a cancelled ride and carried by a redispatch; a scheduled booking's reservation
 * (ruling 3); the member's-own-share discount on shared rides (ruling 2); referral end-to-end with
 * the abuse blocks and the suspension freeze (ruling 6); loyalty accrual and redemption math with
 * wallet traceability; carried dues on top of a discounted total.
 */
class GrowthIntegrationTest extends AbstractRideIntegrationTest {

  @Autowired private ScheduledRideClockService scheduledRideClockService;

  @Test
  @DisplayName("GRW-02: every promo restriction refuses the validate AND the booking")
  void shouldEnforceEveryPromoRestriction() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    assertThat(code(validate(rider, "NOSUCH"))).isEqualTo("promo_not_found");

    UUID offPromo = adminPromo(promoBody("SWITCHED", "percent", "10"));
    ok(patch("/api/v1/admin/promos/" + offPromo, Map.of("active", false), admin), HttpStatus.OK);
    assertThat(code(validate(rider, "SWITCHED"))).isEqualTo("promo_not_found");

    Map<String, Object> future = promoBody("TOMORROW", "percent", "10");
    future.put("startsAt", CLOCK.instant().plus(Duration.ofDays(1)).toString());
    adminPromo(future);
    assertThat(code(validate(rider, "TOMORROW"))).isEqualTo("promo_window");

    UUID otherService =
        jdbcTemplate.queryForObject(
            "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
                + " per_min_rate, minimum_fare) VALUES (?, 'Comfort', 'مريح', 2.00, 0.80, 0.15,"
                + " 3.00) RETURNING service_type_id",
            UUID.class,
            regionId);
    Map<String, Object> serviceBound = promoBody("COMFORT", "percent", "10");
    serviceBound.put("serviceTypeId", otherService.toString());
    adminPromo(serviceBound);
    assertThat(code(validate(rider, "COMFORT"))).isEqualTo("promo_wrong_service");

    UUID otherRegion =
        jdbcTemplate.queryForObject(
            "INSERT INTO regions (name, state, currency) VALUES ('Aleppo Growth', 'active',"
                + " 'SYP') RETURNING region_id",
            UUID.class);
    Map<String, Object> regionBound = promoBody("ALEPPO", "percent", "10");
    regionBound.put("regionId", otherRegion.toString());
    adminPromo(regionBound);
    assertThat(code(validate(rider, "ALEPPO"))).isEqualTo("promo_wrong_region");

    adminPromo(promoBody("FIRSTONLY", "percent", "10"));
    jdbcTemplate.update("UPDATE promos SET first_ride_only = true WHERE code = 'FIRSTONLY'");
    finish(driver, book(rider)); // the rider's first completed ride
    assertThat(code(validate(rider, "FIRSTONLY"))).isEqualTo("promo_first_ride_only");
    assertThat(validate(rider(), "FIRSTONLY").getStatusCode()).isEqualTo(HttpStatus.OK);

    adminPromo(promoBody("ONEUSE", "percent", "10"));
    finish(driver, bookWith(rider, "ONEUSE"));
    assertThat(code(validate(rider, "ONEUSE"))).isEqualTo("promo_user_limit");

    Map<String, Object> capped = promoBody("CAPONE", "percent", "10");
    capped.put("totalCap", 1);
    adminPromo(capped);
    finish(driver, bookWith(rider(), "CAPONE"));
    assertThat(code(validate(rider, "CAPONE"))).isEqualTo("promo_exhausted");

    // A cancelled ride releases its reservation: the cap frees up again.
    Map<String, Object> freed = promoBody("FREED", "percent", "10");
    freed.put("totalCap", 1);
    adminPromo(freed);
    Account canceller = rider();
    UUID cancelled = bookWith(canceller, "FREED");
    assertThat(code(validate(rider, "FREED"))).isEqualTo("promo_exhausted");
    ok(
        post(
            "/api/v1/rides/" + cancelled + "/cancel",
            Map.of("reason", "changed_mind"),
            canceller.token()),
        HttpStatus.OK);
    assertThat(validate(rider, "FREED").getStatusCode()).isEqualTo(HttpStatus.OK);

    // The booking itself refuses a bad code and creates no ride.
    ResponseEntity<JsonNode> refused = tryBookWith(rider, "TOMORROW");
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(refused)).isEqualTo("promo_window");
    assertThat(get("/api/v1/rides/active", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  @Test
  @DisplayName("Rulings 1+GRW-02: promo last with floor at zero; driver made whole via V25")
  void shouldApplyPromoLastAndMakeDriverWhole() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    adminPromo(promoBody("TEN", "percent", "10"));
    JsonNode preview =
        ok(
            post(
                "/api/v1/promos/validate",
                Map.of(
                    "code",
                    "TEN",
                    "regionId",
                    regionId.toString(),
                    "serviceTypeId",
                    economy.toString(),
                    "estimateTotal",
                    "1.50"),
                rider.token()),
            HttpStatus.OK);
    assertThat(preview.get("discountPreview").decimalValue()).isEqualByComparingTo("0.15");

    UUID rideId = finish(driver, bookWith(rider, "TEN"));
    assertThat(fareColumn(rideId, "discount")).isEqualByComparingTo("0.15");
    assertThat(fareColumn(rideId, "total")).isEqualByComparingTo("1.35");
    // Ruling 1: the itemized fare (and so the commission) uses the PRE-discount total, and the
    // discount reaches the driver as its own credit.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT fare_amount FROM driver_ledger WHERE ride_id = ? AND type IN"
                    + " ('ride_earning', 'commission_due')",
                BigDecimal.class,
                rideId))
        .isEqualByComparingTo("1.50");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM driver_ledger WHERE ride_id = ? AND type ="
                    + " 'promo_compensation'",
                BigDecimal.class,
                rideId))
        .isEqualByComparingTo("0.15");

    // A fixed promo larger than the fare floors the total at zero (region-bound per V24).
    Map<String, Object> big = promoBody("BIGFIX", "fixed", "5.00");
    big.put("regionId", regionId.toString());
    adminPromo(big);
    // V1 audit W29: the zero total settles at completion (paid_cash), no cash-confirm.
    UUID floored = bookWith(rider, "BIGFIX");
    dispatchAndAccept(floored, driver);
    arriveAndStart(floored, driver);
    assertThat(
            ok(driverAction(driver, floored, "complete"), HttpStatus.OK)
                .get("paymentStatus")
                .asText())
        .isEqualTo("paid_cash");
    assertThat(fareColumn(floored, "discount")).isEqualByComparingTo("1.50");
    assertThat(fareColumn(floored, "total")).isEqualByComparingTo("0.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM driver_ledger WHERE ride_id = ? AND type ="
                    + " 'promo_compensation'",
                BigDecimal.class,
                floored))
        .isEqualByComparingTo("1.50");
  }

  @Test
  @DisplayName("GRW-02: a driver-cancel redispatch carries the promo to the new ride")
  void shouldCarryPromoOnRedispatch() {
    Account rider = rider();
    Account canceller = driverAt(PICKUP_LAT, PICKUP_LNG);
    adminPromo(promoBody("CARRIED", "percent", "10"));
    UUID rideId = bookWith(rider, "CARRIED");
    dispatchAndAccept(rideId, canceller);
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/cancel",
            Map.of("reason", "vehicle_issue"),
            canceller.token()),
        HttpStatus.OK);
    UUID redispatched =
        UUID.fromString(riderRide(rider, rideId).get("redispatchedAsRideId").asText());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM promo_redemptions WHERE ride_id = ?",
                Integer.class,
                redispatched))
        .isEqualTo(1);
    Account next = driverAt(PICKUP_LAT, PICKUP_LNG); // the canceller is excluded
    dispatchAndAccept(redispatched, next);
    arriveAndStart(redispatched, next);
    ok(driverAction(next, redispatched, "complete"), HttpStatus.OK);
    assertThat(fareColumn(redispatched, "discount")).isEqualByComparingTo("0.15");
  }

  @Test
  @DisplayName("Ruling 3: a scheduled booking reserves the promo now, the amount at ride time")
  void shouldReserveScheduledPromoAtBooking() {
    Account rider = rider();
    Account other = rider();
    Map<String, Object> capped = promoBody("SCHED", "percent", "10");
    capped.put("totalCap", 1);
    adminPromo(capped);

    Map<String, Object> request = booking(List.of());
    request.remove("stops");
    request.put("stops", List.of());
    request.put("scheduledAt", CLOCK.instant().plus(Duration.ofHours(2)).toString());
    request.put("promoCode", "SCHED");
    JsonNode scheduled =
        ok(post("/api/v1/scheduled-rides", request, rider.token()), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(scheduled.get("id").asText());

    // Reserved at booking: the cap is taken before the ride ever runs; the preview is null.
    assertThat(code(validate(other, "SCHED"))).isEqualTo("promo_exhausted");

    // T − 15: unclaimed → live dispatch; the discount computes against the ride-time fare.
    advanceTo(CLOCK.instant().plus(Duration.ofHours(2)).minus(Duration.ofMinutes(15)));
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("requested");
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(fareColumn(rideId, "discount")).isEqualByComparingTo("0.15");
  }

  @Test
  @DisplayName("Ruling 2: a shared promo discounts only the redeeming member's own share")
  void shouldDiscountOnlyTheMembersShare() {
    growthSettings(
        "{\"referralReferrerAmount\": 0, \"referralRefereeAmount\": 0,"
            + " \"pointsPerCurrencyUnit\": 100, \"redemptionThresholdPoints\": 50,"
            + " \"redemptionRate\": 0.5}");
    Account creator = rider();
    Account joiner = rider();
    Account third = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    adminPromo(promoBody("HALF", "percent", "50"));

    Map<String, Object> create = new LinkedHashMap<>();
    create.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    create.put("destination", place(DEST_LAT, DEST_LNG));
    create.put("serviceTypeId", economy.toString());
    create.put("paymentMethod", "cash");
    create.put("totalSeats", 3);
    create.put("partySize", 1);
    create.put(
        "departure",
        Map.of(
            "mode", "at_time", "departAt", CLOCK.instant().plus(Duration.ofHours(1)).toString()));
    JsonNode sharedRide =
        ok(post("/api/v1/shared-rides", create, creator.token()), HttpStatus.CREATED);
    UUID rideId = UUID.fromString(sharedRide.get("rideId").asText());

    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash", "promoCode", "HALF"),
            joiner.token()),
        HttpStatus.OK);
    // One promo per ride, never stacked (V24): the third member's code is refused.
    ResponseEntity<JsonNode> stacked =
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash", "promoCode", "HALF"),
            third.token());
    assertThat(code(stacked)).isEqualTo("promo_already_applied");
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash"),
            third.token()),
        HttpStatus.OK);

    dispatch();
    String offerId = openOffer(driver).get("id").asText();
    ok(accept(driver, offerId), HttpStatus.OK);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);

    // The split is per boarded seat; only the joiner's share shrinks (ruling 2).
    BigDecimal perSeat =
        jdbcTemplate.queryForObject(
            "SELECT per_seat_amount FROM shared_rides WHERE ride_id = ?", BigDecimal.class, rideId);
    BigDecimal creatorShare = shareOf(rideId, creator.userId());
    BigDecimal joinerShare = shareOf(rideId, joiner.userId());
    BigDecimal discount = perSeat.multiply(new BigDecimal("0.50")).setScale(2);
    assertThat(creatorShare).isEqualByComparingTo(perSeat);
    assertThat(joinerShare).isEqualByComparingTo(perSeat.subtract(discount));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM promo_redemptions WHERE ride_id = ?", BigDecimal.class, rideId))
        .isEqualByComparingTo(discount);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM driver_ledger WHERE ride_id = ? AND type ="
                    + " 'promo_compensation'",
                BigDecimal.class,
                rideId))
        .isEqualByComparingTo(discount);

    // Cross-feature: loyalty accrues on the member's OWN paid (discounted) share.
    confirmMember(driver, rideId, creator.userId());
    confirmMember(driver, rideId, joiner.userId());
    confirmMember(driver, rideId, third.userId());
    long joinerPoints =
        jdbcTemplate.queryForObject(
            "SELECT COALESCE(SUM(points), 0) FROM points_transactions WHERE user_id = ? AND type"
                + " = 'accrual'",
            Long.class,
            joiner.userId());
    assertThat(joinerPoints)
        .isEqualTo(
            joinerShare
                .multiply(new BigDecimal("100"))
                .setScale(0, java.math.RoundingMode.FLOOR)
                .longValue());
  }

  @Test
  @DisplayName(
      "M13 fix H1: a leaving promo holder releases the reservation — cap freed, another"
          + " member may apply")
  void shouldReleasePromoWhenMemberLeaves() {
    growthSettings(
        "{\"referralReferrerAmount\": 0, \"referralRefereeAmount\": 0,"
            + " \"pointsPerCurrencyUnit\": 1, \"redemptionThresholdPoints\": 100,"
            + " \"redemptionRate\": 0.5}");
    driverAt(PICKUP_LAT, PICKUP_LNG); // a 3-seat vehicle must exist for a 3-seat shared ride
    Account creator = rider();
    Account joiner = rider();
    Account third = rider();
    Map<String, Object> capped = promoBody("LEAVER", "percent", "50");
    capped.put("totalCap", 1);
    adminPromo(capped);

    Map<String, Object> create = new LinkedHashMap<>();
    create.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    create.put("destination", place(DEST_LAT, DEST_LNG));
    create.put("serviceTypeId", economy.toString());
    create.put("paymentMethod", "cash");
    create.put("totalSeats", 3);
    create.put("partySize", 1);
    create.put(
        "departure",
        Map.of(
            "mode", "at_time", "departAt", CLOCK.instant().plus(Duration.ofHours(1)).toString()));
    UUID rideId =
        UUID.fromString(
            ok(post("/api/v1/shared-rides", create, creator.token()), HttpStatus.CREATED)
                .get("rideId")
                .asText());
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash", "promoCode", "LEAVER"),
            joiner.token()),
        HttpStatus.OK);
    // The cap (1) is taken and the ride's one-promo slot is held.
    assertThat(code(validate(third, "LEAVER"))).isEqualTo("promo_exhausted");

    // The holder leaves during gathering: cap freed, the ride's slot freed.
    ok(post("/api/v1/shared-rides/" + rideId + "/leave", Map.of(), joiner.token()), HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM promo_redemptions WHERE ride_id = ?", Integer.class, rideId))
        .isZero();
    assertThat(validate(third, "LEAVER").getStatusCode()).isEqualTo(HttpStatus.OK);
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/join",
            Map.of("partySize", 1, "paymentMethod", "cash", "promoCode", "LEAVER"),
            third.token()),
        HttpStatus.OK);
  }

  @Test
  @DisplayName("M13 fix W1: one alive first-ride reservation per rider")
  void shouldRefuseSecondFirstRideReservation() {
    Account rider = rider();
    Map<String, Object> first = promoBody("WELCOMEA", "percent", "10");
    adminPromo(first);
    jdbcTemplate.update("UPDATE promos SET first_ride_only = true WHERE code = 'WELCOMEA'");
    Map<String, Object> second = promoBody("WELCOMEB", "percent", "10");
    adminPromo(second);
    jdbcTemplate.update("UPDATE promos SET first_ride_only = true WHERE code = 'WELCOMEB'");

    Map<String, Object> request = booking(List.of());
    request.put("scheduledAt", CLOCK.instant().plus(Duration.ofHours(2)).toString());
    request.put("promoCode", "WELCOMEA");
    ok(post("/api/v1/scheduled-rides", request, rider.token()), HttpStatus.CREATED);

    // A second first-ride code is refused while the scheduled reservation is alive.
    ResponseEntity<JsonNode> refused = tryBookWith(rider, "WELCOMEB");
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(refused)).isEqualTo("promo_first_ride_only");
    // A plain promo still works.
    adminPromo(promoBody("PLAIN", "percent", "10"));
    assertThat(tryBookWith(rider, "PLAIN").getStatusCode()).isEqualTo(HttpStatus.CREATED);
  }

  @Test
  @DisplayName(
      "M13 fix W5: a region paying 0/0 leaves the referral pending — never rewarded"
          + " with nothing paid")
  void shouldKeepReferralPendingWhenRegionPaysNothing() {
    growthSettings(
        "{\"referralReferrerAmount\": 0, \"referralRefereeAmount\": 0,"
            + " \"pointsPerCurrencyUnit\": 1, \"redemptionThresholdPoints\": 100,"
            + " \"redemptionRate\": 0.5}");
    Account referrer = rider();
    Account referee = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String code =
        ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK).get("code").asText();
    ok(enter(referee, code), HttpStatus.OK);
    finish(driver, book(referee));
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM referrals WHERE referee_user_id = ?",
                String.class,
                referee.userId()))
        .isEqualTo("pending");
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName("M13 fix W7 + H2: percent above 100 → 422; a cap patch is audited before/after")
  void shouldValidatePercentAndAuditCapPatch() {
    ResponseEntity<JsonNode> refused =
        post("/api/v1/admin/promos", promoBody("OVER", "percent", "150"), admin);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(refused)).isEqualTo("value_invalid");

    Map<String, Object> capped = promoBody("AUDITME", "percent", "10");
    capped.put("totalCap", 5);
    UUID promoId = adminPromo(capped);
    ok(patch("/api/v1/admin/promos/" + promoId, Map.of("totalCap", 50), admin), HttpStatus.OK);
    Map<String, Object> audit =
        jdbcTemplate.queryForMap(
            "SELECT before_state ->> 'totalCap' AS before, after_state ->> 'totalCap' AS after"
                + " FROM audit_log WHERE action = 'promo.update' AND target_id = ? ORDER BY"
                + " created_at DESC LIMIT 1",
            promoId.toString());
    assertThat(audit.get("before")).isEqualTo("5");
    assertThat(audit.get("after")).isEqualTo("50");

    // W17: the running filter excludes a future-window promo the active flag would count.
    Map<String, Object> future = promoBody("LATERON", "percent", "10");
    future.put("startsAt", CLOCK.instant().plus(Duration.ofDays(1)).toString());
    future.put("endsAt", CLOCK.instant().plus(Duration.ofDays(2)).toString());
    adminPromo(future);
    long active =
        ok(get("/api/v1/admin/promos?active=true&size=1", admin), HttpStatus.OK)
            .get("totalItems")
            .asLong();
    long running =
        ok(get("/api/v1/admin/promos?running=true&size=1", admin), HttpStatus.OK)
            .get("totalItems")
            .asLong();
    assertThat(active).isEqualTo(running + 1);
  }

  @Test
  @DisplayName("GRW-03: referral end-to-end — first completed ride pays both sides, exactly once")
  void shouldRunReferralEndToEnd() {
    growthSettings(
        "{\"referralReferrerAmount\": 3.00, \"referralRefereeAmount\": 2.00,"
            + " \"pointsPerCurrencyUnit\": 1, \"redemptionThresholdPoints\": 100,"
            + " \"redemptionRate\": 0.5}");
    Account referrer = rider();
    Account referee = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    JsonNode me =
        ok(get("/api/v1/referrals/me?regionId=" + regionId, referrer.token()), HttpStatus.OK);
    String code = me.get("code").asText();
    // The reward block carries the region amounts only when a regionId is named (T3 amendment).
    assertThat(me.get("reward").get("referrerAmount").decimalValue()).isEqualByComparingTo("3.00");
    assertThat(me.get("reward").get("refereeAmount").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(me.get("reward").get("currency").asText()).isNotBlank();
    assertThat(
            ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK).get("reward").isNull())
        .isTrue();

    assertThat(code(enter(referrer, code))).isEqualTo("referral_self");
    JsonNode entered = ok(enter(referee, code), HttpStatus.OK);
    assertThat(entered.get("enteredCode").asText()).isEqualTo(code);
    assertThat(code(enter(referee, code))).isEqualTo("referral_already_entered");

    // Too late: a rider who already completed a ride cannot enter a code.
    Account late = rider();
    finish(driver, book(late));
    assertThat(code(enter(late, code))).isEqualTo("referral_too_late");

    finish(driver, book(referee));
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("3.00");
    assertThat(walletCredit(referee.userId(), "referral")).isEqualByComparingTo("2.00");
    assertThat(outboxEvents(referrer.userId())).contains("growth.referral_rewarded");
    assertThat(outboxEvents(referee.userId())).contains("growth.referral_rewarded");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM referrals WHERE referee_user_id = ?",
                String.class,
                referee.userId()))
        .isEqualTo("rewarded");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM user_badges WHERE user_id = ? AND badge_code ="
                    + " 'first_referral'",
                Integer.class,
                referrer.userId()))
        .isEqualTo(1);

    // The second completed ride pays nothing more.
    finish(driver, book(referee));
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("3.00");

    JsonNode status = ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK);
    assertThat(status.get("referees")).hasSize(1);
    assertThat(status.get("referees").get(0).get("status").asText()).isEqualTo("rewarded");
  }

  @Test
  @DisplayName("Ruling 6: suspension blocks the referral reward and freezes accrual + redemption")
  void shouldFreezeGrowthWhileSuspended() {
    growthSettings(
        "{\"referralReferrerAmount\": 3.00, \"referralRefereeAmount\": 2.00,"
            + " \"pointsPerCurrencyUnit\": 1, \"redemptionThresholdPoints\": 1,"
            + " \"redemptionRate\": 0.5}");
    Account referrer = rider();
    Account referee = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String code =
        ok(get("/api/v1/referrals/me", referrer.token()), HttpStatus.OK).get("code").asText();
    ok(enter(referee, code), HttpStatus.OK);

    UUID rideId = book(referee);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    jdbcTemplate.update("UPDATE users SET state = 'suspended' WHERE user_id = ?", referee.userId());
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);

    // Blocked for good, nothing paid, nothing accrued.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM referrals WHERE referee_user_id = ?",
                String.class,
                referee.userId()))
        .isEqualTo("blocked");
    assertThat(walletCredit(referrer.userId(), "referral")).isEqualByComparingTo("0");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM points_transactions WHERE user_id = ?",
                Integer.class,
                referee.userId()))
        .isZero();
    // Redemption is frozen too; the points (none here) are kept, never wiped.
    ResponseEntity<JsonNode> redeem =
        post(
            "/api/v1/loyalty/redeem",
            Map.of("regionId", regionId.toString(), "points", 1),
            referee.token());
    assertThat(redeem.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(code(redeem)).isEqualTo("account_suspended");
  }

  @Test
  @DisplayName("GRW-04 + GAME-03: accrual and redemption math; levels never move on spending")
  void shouldAccrueAndRedeemPoints() {
    growthSettings(
        "{\"referralReferrerAmount\": 0, \"referralRefereeAmount\": 0,"
            + " \"pointsPerCurrencyUnit\": 400, \"redemptionThresholdPoints\": 100,"
            + " \"redemptionRate\": 0.5}");
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    finish(driver, book(rider)); // fare 1.50 × 400 = 600 points → Silver (≥ 500)

    JsonNode balance =
        ok(get("/api/v1/loyalty?regionId=" + regionId, rider.token()), HttpStatus.OK);
    assertThat(balance.get("redeemable").asLong()).isEqualTo(600);
    assertThat(balance.get("lifetime").asLong()).isEqualTo(600);
    assertThat(balance.get("level").asText()).isEqualTo("silver");
    assertThat(balance.get("rule").get("redemptionThresholdPoints").asLong()).isEqualTo(100);

    assertThat(
            code(
                post(
                    "/api/v1/loyalty/redeem",
                    Map.of("regionId", regionId.toString(), "points", 99),
                    rider.token())))
        .isEqualTo("below_threshold");
    assertThat(
            code(
                post(
                    "/api/v1/loyalty/redeem",
                    Map.of("regionId", regionId.toString(), "points", 601),
                    rider.token())))
        .isEqualTo("insufficient_points");

    JsonNode after =
        ok(
            post(
                "/api/v1/loyalty/redeem",
                Map.of("regionId", regionId.toString(), "points", 500),
                rider.token()),
            HttpStatus.OK);
    // 500 × 0.5 = 250.00 wallet credit; redeemable down, lifetime and level untouched (AC).
    assertThat(after.get("redeemable").asLong()).isEqualTo(100);
    assertThat(after.get("lifetime").asLong()).isEqualTo(600);
    assertThat(after.get("level").asText()).isEqualTo("silver");
    assertThat(walletCredit(rider.userId(), "loyalty_redemption")).isEqualByComparingTo("250.00");
    // Traceability (milestone AC): the points row names its wallet credit.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM points_transactions t JOIN wallet_transactions w ON"
                    + " w.wallet_transaction_id = t.wallet_transaction_id WHERE t.user_id = ? AND"
                    + " t.type = 'redemption' AND t.points = -500 AND w.type ="
                    + " 'loyalty_redemption'",
                Integer.class,
                rider.userId()))
        .isEqualTo(1);
    JsonNode history = ok(get("/api/v1/loyalty/transactions", rider.token()), HttpStatus.OK);
    assertThat(history.get("items").get(0).get("type").asText()).isEqualTo("redemption");
    assertThat(history.get("items").get(1).get("type").asText()).isEqualTo("accrual");
  }

  @Test
  @DisplayName("Cross-feature: a carried due rides on top of the discounted total")
  void shouldCarryDuesOnTopOfDiscountedTotal() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    adminPromo(promoBody("DUETEN", "percent", "10"));

    // A post-grace rider cancel leaves a 2.00 due (cash method, region fee).
    UUID cancelled = book(rider);
    dispatchAndAccept(cancelled, driver);
    advance(Duration.ofMinutes(3));
    ok(
        post(
            "/api/v1/rides/" + cancelled + "/cancel",
            Map.of("reason", "changed_mind"),
            rider.token()),
        HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rider_dues WHERE rider_user_id = ? AND collected_at IS"
                    + " NULL",
                Integer.class,
                rider.userId()))
        .isEqualTo(1);

    // The promo shrinks the fare; the due is earmarked on top and collected at cash-confirm.
    position(driver, PICKUP_LAT, PICKUP_LNG); // fresh location after the clock advance
    UUID rideId = bookWith(rider, "DUETEN");
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(fareColumn(rideId, "discount")).isEqualByComparingTo("0.15");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rider_dues WHERE rider_user_id = ? AND collecting_ride_id"
                    + " = ?",
                Integer.class,
                rider.userId(),
                rideId))
        .isEqualTo(1);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM rider_dues WHERE rider_user_id = ? AND collected_at IS NOT"
                    + " NULL",
                Integer.class,
                rider.userId()))
        .isEqualTo(1);
  }

  // ---- helpers ------------------------------------------------------------------------------

  private UUID bookWith(Account rider, String promoCode) {
    JsonNode ride = ok(tryBookWith(rider, promoCode), HttpStatus.CREATED);
    return UUID.fromString(ride.get("id").asText());
  }

  private ResponseEntity<JsonNode> tryBookWith(Account rider, String promoCode) {
    Map<String, Object> body = booking(List.of());
    body.put("promoCode", promoCode);
    return tryBook(rider, body);
  }

  /** Books (optionally) and runs the ride to a confirmed cash completion. */
  private UUID finish(Account driver, UUID rideId) {
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    return rideId;
  }

  private ResponseEntity<JsonNode> validate(Account rider, String code) {
    return post(
        "/api/v1/promos/validate",
        Map.of(
            "code", code,
            "regionId", regionId.toString(),
            "serviceTypeId", economy.toString()),
        rider.token());
  }

  private ResponseEntity<JsonNode> enter(Account account, String code) {
    return post("/api/v1/referrals/enter", Map.of("code", code), account.token());
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

  private void growthSettings(String json) {
    jdbcTemplate.update(
        "UPDATE regions SET growth_settings = ?::jsonb WHERE region_id = ?", json, regionId);
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

  private BigDecimal shareOf(UUID rideId, UUID riderUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT share_amount FROM shared_ride_members WHERE ride_id = ? AND rider_user_id = ?",
        BigDecimal.class,
        rideId,
        riderUserId);
  }

  private void confirmMember(Account driver, UUID rideId, UUID riderUserId) {
    UUID memberId =
        jdbcTemplate.queryForObject(
            "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
                + " rider_user_id = ?",
            UUID.class,
            rideId,
            riderUserId);
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/members/" + memberId + "/cash-confirm",
            null,
            driver.token()),
        HttpStatus.OK);
  }

  private void advanceTo(Instant moment) {
    CLOCK.set(moment);
  }

  private ResponseEntity<JsonNode> patch(String url, Object body, String token) {
    org.springframework.http.HttpHeaders headers = bearer(token);
    headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
    return restTemplate.exchange(
        url,
        org.springframework.http.HttpMethod.PATCH,
        new org.springframework.http.HttpEntity<>(body, headers),
        JsonNode.class);
  }
}
