package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M12-T2 Phase C1 (scheduled-shared-v1.yaml RIDE-P4/P5 × money-v1): every member of a completed
 * shared ride pays THEIR share by THEIR method with THEIR carried dues; one fare ledger entry per
 * member with the commission on the share; per-member cash-confirm / mark-unpaid; the driver's
 * current ride while a member is pending; member fees collected (wallet / due) and credited per
 * member; member views, receipts, tips and refunds.
 */
class SharedRideMoneyIntegrationTest extends AbstractMoneyIntegrationTest {

  @Test
  @DisplayName("RIDE-P4: cash, full-wallet and partial-wallet members each pay their own share")
  void shouldSettleEachMemberIndependently() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    // The creator carries a cash due (2.00) from an earlier cancelled ride.
    cancelAfterGrace(creator, driver, "cash");
    Account walletMember = rider();
    Account partialMember = rider();
    grant(walletMember.userId(), "10.00");
    grant(partialMember.userId(), "0.20");
    UUID rideId = create(creator, 4, 1, "cash");
    ok(join(walletMember, rideId, 2, "wallet"), HttpStatus.OK);
    ok(join(partialMember, rideId, 1, "wallet"), HttpStatus.OK); // full → dispatch
    position(driver, PICKUP_LAT, PICKUP_LNG); // fresh again after the grace wait
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(completed.get("paymentStatus").asText()).isEqualTo("split");

    UUID creatorMember = memberId(rideId, creator.userId());
    UUID walletMemberId = memberId(rideId, walletMember.userId());
    UUID partialMemberId = memberId(rideId, partialMember.userId());
    BigDecimal creatorShare = share(creatorMember);
    BigDecimal walletShare = share(walletMemberId);
    BigDecimal partialShare = share(partialMemberId);
    assertThat(creatorShare.add(walletShare).add(partialShare)).isEqualByComparingTo(FARE);

    // The full-wallet member is auto-confirmed; the others wait for the driver.
    assertThat(paymentStatus(walletMemberId)).isEqualTo("paid_wallet");
    assertThat(paymentStatus(partialMemberId)).isEqualTo("pending");
    assertThat(paymentStatus(creatorMember)).isEqualTo("pending");
    assertThat(walletBalance(walletMember.userId()))
        .isEqualByComparingTo(new BigDecimal("10.00").subtract(walletShare));
    assertThat(walletBalance(partialMember.userId())).isEqualByComparingTo("0");

    // One fare entry per member, commission on the member's share (25% default tier).
    Map<UUID, Map<String, Object>> fareEntries = fareEntriesByMember(rideId);
    assertThat(fareEntries).containsOnlyKeys(creatorMember, walletMemberId, partialMemberId);
    assertFareEntry(fareEntries.get(creatorMember), creatorShare, BigDecimal.ZERO);
    assertFareEntry(fareEntries.get(walletMemberId), walletShare, walletShare);
    assertFareEntry(fareEntries.get(partialMemberId), partialShare, new BigDecimal("0.20"));

    // Views: the driver sees each member's split; a member sees only their own money.
    JsonNode members = completed.get("shared").get("members");
    JsonNode partialView = member(members, partialMemberId);
    assertThat(partialView.get("walletApplied").decimalValue()).isEqualByComparingTo("0.20");
    assertThat(partialView.get("cashDue").decimalValue())
        .isEqualByComparingTo(partialShare.subtract(new BigDecimal("0.20")));
    assertThat(member(members, creatorMember).get("cashDue").decimalValue())
        .isEqualByComparingTo(creatorShare.add(new BigDecimal("2.00")));
    assertThat(completed.get("walletApplied").isNull()).isTrue();
    JsonNode creatorRide = riderRide(creator, rideId);
    assertThat(creatorRide.get("cashDue").decimalValue())
        .isEqualByComparingTo(creatorShare.add(new BigDecimal("2.00")));
    assertThat(creatorRide.get("carriedDues")).hasSize(1);
    assertThat(creatorRide.get("shared").get("me").get("cashDue").decimalValue())
        .isEqualByComparingTo(creatorShare.add(new BigDecimal("2.00")));
    JsonNode walletRide = riderRide(walletMember, rideId);
    assertThat(walletRide.get("walletApplied").decimalValue()).isEqualByComparingTo(walletShare);
    assertThat(walletRide.get("cashDue").isNull()).isTrue();
    assertThat(walletRide.get("carriedDues")).isEmpty();

    // Each member's own receipt.
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", walletMember.token()), HttpStatus.OK);
    assertThat(receipt.get("paymentMethod").asText()).isEqualTo("wallet");
    assertThat(receipt.get("walletApplied").decimalValue()).isEqualByComparingTo(walletShare);
    assertThat(receipt.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo(FARE);
    assertThat(
            ok(get("/api/v1/rides/" + rideId + "/receipt", creator.token()), HttpStatus.OK)
                .get("paymentMethod")
                .asText())
        .isEqualTo("cash");
    assertThat(get("/api/v1/rides/" + rideId + "/receipt", rider().token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    // Each member got their own completion push.
    assertThat(outboxEvents(partialMember.userId())).contains("ride.completed");
    assertThat(completionParams(partialMember.userId()))
        .containsEntry("total", partialShare.toPlainString())
        .containsEntry("walletApplied", "0.20");

    // The ride stays the driver's current one while a member is pending.
    assertThat(
            ok(get("/api/v1/driver/rides/active", driver.token()), HttpStatus.OK)
                .get("id")
                .asText())
        .isEqualTo(rideId.toString());
    // Only a pending member can be settled.
    assertThat(code(memberAction(driver, rideId, walletMemberId, "cash-confirm")))
        .isEqualTo("illegal_state");

    // The creator's cash arrives: their carried due is collected with it.
    BigDecimal balanceBefore = driverBalance(driver.userId());
    JsonNode afterCreator =
        ok(memberAction(driver, rideId, creatorMember, "cash-confirm"), HttpStatus.OK);
    assertThat(
            member(afterCreator.get("shared").get("members"), creatorMember)
                .get("paymentStatus")
                .asText())
        .isEqualTo("paid_cash");
    // due_collection −2.00 and the cancelled ride's fee +2.00 (same driver here).
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo(balanceBefore);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM rider_dues WHERE rider_user_id = ?",
                String.class,
                creator.userId()))
        .isEqualTo("collected");
    assertThat(paymentConfirmedAt(rideId)).isNull();

    // The partial member never pays the rest: unpaid, and the ride is now resolved.
    ok(memberAction(driver, rideId, partialMemberId, "mark-unpaid"), HttpStatus.OK);
    assertThat(paymentStatus(partialMemberId)).isEqualTo("unpaid");
    assertThat(paymentConfirmedAt(rideId)).isNotNull();
    assertThat(code(memberAction(driver, rideId, partialMemberId, "cash-confirm")))
        .isEqualTo("illegal_state");
    assertThat(get("/api/v1/driver/rides/active", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    // Another driver cannot act on the members.
    Account stranger = driverAt(PICKUP_LAT, PICKUP_LNG);
    assertThat(memberAction(stranger, rideId, creatorMember, "cash-confirm").getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("RIDE-P5: a member's no-show fee comes from their wallet, a cash fee becomes a due")
  void shouldCollectMemberFeesPerMember() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account walletMember = rider();
    Account cashMember = rider();
    grant(walletMember.userId(), "5.00");
    UUID rideId = create(creator, 3, 1, "cash");
    ok(join(walletMember, rideId, 1, "wallet"), HttpStatus.OK);
    ok(join(cashMember, rideId, 1, "cash"), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    UUID walletMemberId = memberId(rideId, walletMember.userId());
    UUID cashMemberId = memberId(rideId, cashMember.userId());

    // A cash member leaving after the grace owes the fee as a due in THEIR name.
    advance(Duration.ofMinutes(3));
    ok(
        post(
            "/api/v1/shared-rides/" + rideId + "/leave",
            Map.of("reason", "changed_mind"),
            cashMember.token()),
        HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM rider_dues WHERE rider_user_id = ? AND source_ride_id = ?",
                BigDecimal.class,
                cashMember.userId(),
                rideId))
        .isEqualByComparingTo("2.00");
    JsonNode cashMemberRide = riderRide(cashMember, rideId);
    assertThat(cashMemberRide.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(riderRide(creator, rideId).get("cancellationFee").isNull()).isTrue();

    // The wallet member is absent: the no-show fee is taken from their wallet and credited.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    advance(Duration.ofMinutes(6));
    ok(
        post(
            "/api/v1/driver/rides/" + rideId + "/members/" + walletMemberId + "/no-show",
            null,
            driver.token()),
        HttpStatus.OK);
    assertThat(walletBalance(walletMember.userId())).isEqualByComparingTo("3.00");
    assertThat(cancellationCredits(rideId)).containsExactly(Map.of(walletMemberId, "2.00"));

    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    UUID creatorMember = memberId(rideId, creator.userId());
    assertThat(share(creatorMember)).isEqualByComparingTo(FARE);
    ok(memberAction(driver, rideId, creatorMember, "cash-confirm"), HttpStatus.OK);

    // The cash member's next ride carries the due; on its cash the shared ride's driver is
    // credited the MEMBER's fee, attributed to the member.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    UUID next = completeRide(cashMember, driver, "cash");
    ok(driverAction(driver, next, "cash-confirm"), HttpStatus.OK);
    assertThat(cancellationCredits(rideId))
        .containsExactlyInAnyOrder(Map.of(walletMemberId, "2.00"), Map.of(cashMemberId, "2.00"));
    assertLedgerInvariants();
  }

  @Test
  @DisplayName("PAY-04 per member: each member tips once; refunds reach a member")
  void shouldTipAndRefundPerMember() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account member = rider();
    grant(creator.userId(), "5.00");
    grant(member.userId(), "5.00");
    UUID rideId = create(creator, 2, 1, "cash");
    ok(join(member, rideId, 1, "cash"), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    // A member tips while riding.
    ok(tip(member, rideId, "1.00"), HttpStatus.CREATED);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(tip(creator, rideId, "0.50"), HttpStatus.CREATED);
    assertThat(code(tip(member, rideId, "1.00"))).isEqualTo("already_tipped");
    assertThat(tip(rider(), rideId, "1.00").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

    List<Map<String, Object>> tips =
        jdbcTemplate.queryForList(
            "SELECT shared_ride_member_id, amount FROM driver_ledger WHERE ride_id = ? AND"
                + " type = 'tip'",
            rideId);
    assertThat(tips).hasSize(2);
    assertThat(tips.stream().map(row -> row.get("shared_ride_member_id")))
        .containsExactlyInAnyOrder(
            memberId(rideId, creator.userId()), memberId(rideId, member.userId()));
    assertThat(riderRide(member, rideId).get("tip").decimalValue()).isEqualByComparingTo("1.00");
    assertThat(riderRide(creator, rideId).get("tip").decimalValue()).isEqualByComparingTo("0.50");
    assertThat(
            ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK)
                .get("tip")
                .decimalValue())
        .isEqualByComparingTo("1.50");

    // V1 audit H6: the earnings page attaches each member's own tip to that member's fare row
    // (it returned 500 with two tips), and the summary counts the shared ride as ONE trip.
    JsonNode items = ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK).get("items");
    List<String> rowTips = new java.util.ArrayList<>();
    for (JsonNode item : items) {
      if (item.get("rideId").asText().equals(rideId.toString())) {
        rowTips.add(
            item.get("tip").isNull()
                ? null
                : item.get("tip").decimalValue().setScale(2).toPlainString());
      }
    }
    // One fare row per member, each with that member's own tip.
    assertThat(rowTips).containsExactlyInAnyOrder("1.00", "0.50");
    JsonNode summary =
        ok(get("/api/v1/driver/earnings/summary?period=weekly", driver.token()), HttpStatus.OK);
    assertThat(summary.get("trips").asInt()).isEqualTo(1);
    assertThat(summary.get("tips").decimalValue()).isEqualByComparingTo("1.50");

    // PAY-03: an admin refund may link the shared ride to a member (not only the creator).
    Map<String, Object> refund = new LinkedHashMap<>();
    refund.put("type", "refund");
    refund.put("amount", "0.50");
    refund.put("currency", "SYP");
    refund.put("reason", "member refund");
    refund.put("rideId", rideId.toString());
    ok(
        post("/api/v1/admin/users/" + member.userId() + "/wallet/credits", refund, admin),
        HttpStatus.CREATED);
    assertLedgerInvariants();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private UUID create(Account creator, int totalSeats, int partySize, String paymentMethod) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", paymentMethod);
    body.put("totalSeats", totalSeats);
    body.put("partySize", partySize);
    body.put("departure", Map.of("mode", "when_full"));
    JsonNode ride = ok(post("/api/v1/shared-rides", body, creator.token()), HttpStatus.CREATED);
    return UUID.fromString(ride.get("rideId").asText());
  }

  private ResponseEntity<JsonNode> join(
      Account rider, UUID rideId, int partySize, String paymentMethod) {
    return post(
        "/api/v1/shared-rides/" + rideId + "/join",
        Map.of("partySize", partySize, "paymentMethod", paymentMethod),
        rider.token());
  }

  private ResponseEntity<JsonNode> memberAction(
      Account driver, UUID rideId, UUID memberId, String action) {
    return post(
        "/api/v1/driver/rides/" + rideId + "/members/" + memberId + "/" + action,
        null,
        driver.token());
  }

  private ResponseEntity<JsonNode> tip(Account rider, UUID rideId, String amount) {
    return post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", amount), rider.token());
  }

  private UUID memberId(UUID rideId, UUID riderUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
            + " rider_user_id = ? ORDER BY joined_at DESC LIMIT 1",
        UUID.class,
        rideId,
        riderUserId);
  }

  private BigDecimal share(UUID memberId) {
    return jdbcTemplate.queryForObject(
        "SELECT share_amount FROM shared_ride_members WHERE shared_ride_member_id = ?",
        BigDecimal.class,
        memberId);
  }

  private String paymentStatus(UUID memberId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_status FROM shared_ride_members WHERE shared_ride_member_id = ?",
        String.class,
        memberId);
  }

  private Object paymentConfirmedAt(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT payment_confirmed_at FROM rides WHERE ride_id = ?", Object.class, rideId);
  }

  private Map<UUID, Map<String, Object>> fareEntriesByMember(UUID rideId) {
    Map<UUID, Map<String, Object>> entries = new LinkedHashMap<>();
    for (Map<String, Object> row :
        jdbcTemplate.queryForList(
            "SELECT shared_ride_member_id, type, amount, fare_amount, commission_amount FROM"
                + " driver_ledger WHERE ride_id = ? AND type IN ('ride_earning',"
                + " 'commission_due')",
            rideId)) {
      entries.put((UUID) row.get("shared_ride_member_id"), row);
    }
    return entries;
  }

  /** The fare entry nets the wallet part minus 25% of the member's share. */
  private static void assertFareEntry(
      Map<String, Object> entry, BigDecimal share, BigDecimal walletApplied) {
    BigDecimal commission =
        share.multiply(new BigDecimal("0.25")).setScale(2, RoundingMode.HALF_UP);
    assertThat((BigDecimal) entry.get("fare_amount")).isEqualByComparingTo(share);
    assertThat((BigDecimal) entry.get("commission_amount")).isEqualByComparingTo(commission);
    assertThat((BigDecimal) entry.get("amount"))
        .isEqualByComparingTo(walletApplied.subtract(commission));
  }

  private static JsonNode member(JsonNode members, UUID memberId) {
    for (JsonNode member : members) {
      if (member.get("memberId").asText().equals(memberId.toString())) {
        return member;
      }
    }
    throw new AssertionError("member " + memberId + " not in view");
  }

  /** The {@code cancellation_fee} driver credits of a ride, as {member -> amount}. */
  private List<Map<UUID, String>> cancellationCredits(UUID rideId) {
    return jdbcTemplate
        .queryForList(
            "SELECT shared_ride_member_id, amount FROM driver_ledger WHERE ride_id = ? AND"
                + " type = 'cancellation_fee' ORDER BY created_at",
            rideId)
        .stream()
        .map(
            row ->
                Map.of(
                    (UUID) row.get("shared_ride_member_id"),
                    ((BigDecimal) row.get("amount")).setScale(2).toPlainString()))
        .toList();
  }

  private Map<String, Object> completionParams(UUID userId) {
    String json =
        jdbcTemplate.queryForObject(
            "SELECT params::text FROM notification_outbox WHERE user_id = ? AND"
                + " event = 'ride.completed' ORDER BY created_at DESC LIMIT 1",
            String.class,
            userId);
    try {
      @SuppressWarnings("unchecked")
      Map<String, Object> params = new ObjectMapper().readValue(json, Map.class);
      return params;
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
