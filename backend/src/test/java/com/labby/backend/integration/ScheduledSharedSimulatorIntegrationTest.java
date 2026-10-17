package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushMessage;
import com.labby.backend.service.PushSender.PushResult;
import com.labby.backend.service.ScheduledRideClockService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
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
 * M12-T5 acceptance — the scheduled & shared walkthrough, scripted on a controlled clock through
 * the real HTTP API, the real clock job and dispatcher, and the real outbox → push path (the push
 * service captured per device token). Four scenarios: (1) schedule → claim → both reminder tiers to
 * both parties → conversion at T − 15 → fulfilled; (2) schedule → unclaimed → fallback at T − 15 →
 * live match → fulfilled; (3) shared: create → a cash and a wallet joiner → auto-start on full →
 * complete → three correct per-seat receipts and ledgers; (4) shared with a no-show member: their
 * fee collected, the fare split over the boarded seats only.
 */
class ScheduledSharedSimulatorIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  /** 25% default base tier. */
  private static final BigDecimal RATE = new BigDecimal("0.25");

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private ScheduledRideClockService scheduledRideClockService;

  /** Every captured push with the device tokens it went to. */
  private final List<Map.Entry<List<?>, PushMessage>> pushes = new CopyOnWriteArrayList<>();

  private final Map<UUID, String> deviceOf = new HashMap<>();
  private int devices;

  @BeforeEach
  void capturePushes() {
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
  }

  // ---- 1. schedule -> claim -> reminders -> fulfil ---------------------------------------------

  @Test
  @DisplayName(
      "RIDE-S1..3: schedule → claim → 24 h + 1 h reminders to both → accepted at T − 15 →"
          + " fulfilled and paid")
  void shouldFulfilClaimedScheduledRide() {
    Account rider = rider();
    registerDevice(rider, "rider");
    Instant pickup = in(Duration.ofDays(2));
    UUID rideId = schedule(rider, pickup);
    assertThat(riderRide(rider, rideId).get("state").asText()).isEqualTo("scheduled");

    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    registerDevice(driver, "driver");
    coverWholeDay(driver, pickup);
    JsonNode board = ok(get("/api/v1/driver/claim-board", driver.token()), HttpStatus.OK);
    assertThat(board.findValuesAsText("rideId")).contains(rideId.toString());
    ok(
        post("/api/v1/driver/scheduled-rides/" + rideId + "/claim", null, driver.token()),
        HttpStatus.OK);
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(rider)).contains("scheduled.claimed");
    assertThat(riderRide(rider, rideId).get("scheduled").get("claimState").asText())
        .isEqualTo("claimed");

    // Both tiers reach both parties' devices.
    CLOCK.set(pickup.minus(Duration.ofHours(24)));
    scheduledRideClockService.processDue();
    CLOCK.set(pickup.minus(Duration.ofHours(1)));
    scheduledRideClockService.processDue();
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(rider).stream().filter("scheduled.reminder"::equals)).hasSize(2);
    assertThat(pushedEvents(driver).stream().filter("scheduled.reminder"::equals)).hasSize(2);

    // At T − 15 the claim converts into a live accepted ride.
    CLOCK.set(pickup.minus(Duration.ofMinutes(15)));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("accepted");
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(rider)).contains("scheduled.converted");
    assertThat(pushedEvents(driver)).contains("scheduled.converted");

    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(completed.get("kind").asText()).isEqualTo("scheduled");
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertReceiptAndFareEntry(rider, driver, rideId);
    assertLedgerInvariants();
  }

  // ---- 2. schedule -> unclaimed -> fallback -> live match ------------------------------------

  @Test
  @DisplayName("RIDE-S4: unclaimed at T − 15 → live dispatch → a nearby driver accepts → fulfilled")
  void shouldFallBackAndMatchLive() {
    Account rider = rider();
    Instant pickup = in(Duration.ofHours(3));
    UUID rideId = schedule(rider, pickup);
    CLOCK.set(pickup.minus(Duration.ofMinutes(15)));
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    scheduledRideClockService.processDue();
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(riderRide(rider, rideId).get("scheduled").get("claimState").asText())
        .isEqualTo("fallen_back");

    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertReceiptAndFareEntry(rider, driver, rideId);
    assertLedgerInvariants();
  }

  // ---- 3. shared: create -> 2 joiners -> auto-start -> three receipts -------------------------

  @Test
  @DisplayName(
      "RIDE-P1..4: create → a cash and a wallet joiner → auto-start on full → three correct"
          + " per-seat receipts and ledgers")
  void shouldSettleThreeMembersOnAutoStartedSharedRide() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account creator = rider();
    Account cashJoiner = rider();
    Account walletJoiner = rider();
    grant(walletJoiner.userId(), "5.00");
    UUID rideId = createShared(creator, 3, 1);
    ok(join(cashJoiner, rideId, 1, "cash"), HttpStatus.OK);
    assertThat(stateOf(rideId)).isEqualTo("gathering");
    ok(join(walletJoiner, rideId, 1, "wallet"), HttpStatus.OK);
    // Full → dispatched by itself.
    assertThat(stateOf(rideId)).isEqualTo("requested");
    assertThat(trigger(rideId)).isEqualTo("full");
    for (Account member : List.of(creator, cashJoiner, walletJoiner)) {
      assertThat(outboxEvents(member.userId())).contains("shared.dispatched");
    }

    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    BigDecimal fare = completed.get("fare").get("components").get("total").decimalValue();
    BigDecimal perSeat = fare.divide(BigDecimal.valueOf(3), 2, RoundingMode.HALF_UP);
    assertThat(completed.get("shared").get("split").get("boardedSeats").asInt()).isEqualTo(3);
    assertThat(completed.get("shared").get("split").get("perSeatAmount").decimalValue())
        .isEqualByComparingTo(perSeat);
    BigDecimal creatorShare = fare.subtract(perSeat.multiply(BigDecimal.valueOf(2)));

    // The wallet joiner is paid at once; the driver collects the two cash members.
    UUID creatorMember = memberId(rideId, creator);
    UUID cashMember = memberId(rideId, cashJoiner);
    ok(memberAction(driver, rideId, creatorMember, "cash-confirm"), HttpStatus.OK);
    ok(memberAction(driver, rideId, cashMember, "cash-confirm"), HttpStatus.OK);
    assertThat(get("/api/v1/driver/rides/active", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    assertMemberReceipt(creator, rideId, fare, "cash", "paid_cash", creatorShare, null);
    assertMemberReceipt(cashJoiner, rideId, fare, "cash", "paid_cash", perSeat, null);
    assertMemberReceipt(walletJoiner, rideId, fare, "wallet", "paid_wallet", perSeat, perSeat);
    assertThat(walletBalance(walletJoiner.userId()))
        .isEqualByComparingTo(new BigDecimal("5.00").subtract(perSeat));
    Map<UUID, BigDecimal> entries = fareEntries(rideId);
    assertThat(entries).hasSize(3);
    assertThat(entries.get(creatorMember)).isEqualByComparingTo(commission(creatorShare).negate());
    assertThat(entries.get(cashMember)).isEqualByComparingTo(commission(perSeat).negate());
    assertThat(entries.get(memberId(rideId, walletJoiner)))
        .isEqualByComparingTo(perSeat.subtract(commission(perSeat)));
    assertLedgerInvariants();
  }

  // ---- 4. shared with a no-show member ---------------------------------------------------------

  @Test
  @DisplayName(
      "UC-D-13 E1: a wallet member is absent — their fee is collected and credited, the fare"
          + " splits over the boarded seats only")
  void shouldChargeNoShowAndSplitOverBoardedSeats() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    registerDevice(driver, "driver");
    Account creator = rider();
    Account pair = rider();
    Account absent = rider();
    registerDevice(absent, "rider");
    grant(absent.userId(), "5.00");
    UUID rideId = createShared(creator, 4, 1);
    ok(join(pair, rideId, 2, "cash"), HttpStatus.OK);
    ok(join(absent, rideId, 1, "wallet"), HttpStatus.OK);
    dispatchAndAccept(rideId, driver);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    CLOCK.set(CLOCK.instant().plus(Duration.ofMinutes(6))); // past the 5-minute wait grace
    UUID absentMember = memberId(rideId, absent);
    ok(memberAction(driver, rideId, absentMember, "no-show"), HttpStatus.OK);
    notificationDispatchService.dispatchPending();
    assertThat(pushedEvents(absent)).contains("shared.member_no_show");
    assertThat(walletBalance(absent.userId())).isEqualByComparingTo("3.00");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT amount FROM driver_ledger WHERE ride_id = ? AND type = 'cancellation_fee'"
                    + " AND shared_ride_member_id = ?",
                BigDecimal.class,
                rideId,
                absentMember))
        .isEqualByComparingTo("2.00");

    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    JsonNode completed = ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    BigDecimal fare = completed.get("fare").get("components").get("total").decimalValue();
    BigDecimal perSeat = fare.divide(BigDecimal.valueOf(3), 2, RoundingMode.HALF_UP);
    assertThat(completed.get("shared").get("split").get("boardedSeats").asInt()).isEqualTo(3);
    BigDecimal pairShare = perSeat.multiply(BigDecimal.valueOf(2));
    BigDecimal creatorShare = fare.subtract(pairShare);
    ok(memberAction(driver, rideId, memberId(rideId, creator), "cash-confirm"), HttpStatus.OK);
    ok(memberAction(driver, rideId, memberId(rideId, pair), "cash-confirm"), HttpStatus.OK);

    assertMemberReceipt(creator, rideId, fare, "cash", "paid_cash", creatorShare, null);
    assertMemberReceipt(pair, rideId, fare, "cash", "paid_cash", pairShare, null);
    // The absent member owes the fee, not a share: no receipt, their own view says no_show.
    assertThat(get("/api/v1/rides/" + rideId + "/receipt", absent.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    JsonNode absentView = riderRide(absent, rideId);
    assertThat(absentView.get("shared").get("me").get("status").asText()).isEqualTo("no_show");
    assertThat(absentView.get("cancellationFee").decimalValue()).isEqualByComparingTo("2.00");
    assertThat(fareEntries(rideId)).hasSize(2).doesNotContainKey(absentMember);
    assertLedgerInvariants();
  }

  // ---- helpers -------------------------------------------------------------------------------

  private Instant in(Duration duration) {
    return CLOCK.instant().plus(duration).truncatedTo(ChronoUnit.MINUTES);
  }

  private UUID schedule(Account rider, Instant scheduledAt) {
    Map<String, Object> body = new LinkedHashMap<>(booking("cash"));
    body.put("scheduledAt", scheduledAt.toString());
    JsonNode ride = ok(post("/api/v1/scheduled-rides", body, rider.token()), HttpStatus.CREATED);
    return UUID.fromString(ride.get("id").asText());
  }

  /** A whole-day availability window (start = end) on the pickup's local weekday. */
  private void coverWholeDay(Account driver, Instant pickup) {
    int day = pickup.atZone(DAMASCUS).getDayOfWeek().getValue();
    ok(
        put(
            "/api/v1/driver/availability-windows",
            Map.of(
                "windows",
                List.of(Map.of("dayOfWeek", day, "startsAt", "00:00", "endsAt", "00:00"))),
            driver.token()),
        HttpStatus.OK);
  }

  private UUID createShared(Account creator, int totalSeats, int partySize) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", "cash");
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

  private UUID memberId(UUID rideId, Account rider) {
    return jdbcTemplate.queryForObject(
        "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
            + " rider_user_id = ? ORDER BY joined_at DESC LIMIT 1",
        UUID.class,
        rideId,
        rider.userId());
  }

  private String trigger(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT dispatch_trigger FROM shared_rides WHERE ride_id = ?", String.class, rideId);
  }

  private static BigDecimal commission(BigDecimal amount) {
    return amount.multiply(RATE).setScale(2, RoundingMode.HALF_UP);
  }

  /** The fare entries of a shared ride by member (amount = what the platform owes the driver). */
  private Map<UUID, BigDecimal> fareEntries(UUID rideId) {
    Map<UUID, BigDecimal> entries = new HashMap<>();
    for (Map<String, Object> row :
        jdbcTemplate.queryForList(
            "SELECT shared_ride_member_id, amount FROM driver_ledger WHERE ride_id = ? AND type"
                + " IN ('ride_earning', 'commission_due')",
            rideId)) {
      entries.put((UUID) row.get("shared_ride_member_id"), (BigDecimal) row.get("amount"));
    }
    return entries;
  }

  /** A one-rider cash ride: the receipt shows the stored fare; one commission_due entry. */
  private void assertReceiptAndFareEntry(Account rider, Account driver, UUID rideId) {
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", rider.token()), HttpStatus.OK);
    BigDecimal fare = receipt.get("fare").get("components").get("total").decimalValue();
    assertThat(receipt.get("paymentStatus").asText()).isEqualTo("paid_cash");
    assertThat(receipt.get("driver").get("firstName").asText()).isNotBlank();
    List<Map<String, Object>> entries =
        jdbcTemplate.queryForList(
            "SELECT type, amount, fare_amount FROM driver_ledger WHERE ride_id = ? AND"
                + " driver_user_id = ?",
            rideId,
            driver.userId());
    assertThat(entries).hasSize(1);
    assertThat(entries.get(0).get("type")).isEqualTo("commission_due");
    assertThat((BigDecimal) entries.get(0).get("fare_amount")).isEqualByComparingTo(fare);
    assertThat((BigDecimal) entries.get(0).get("amount"))
        .isEqualByComparingTo(commission(fare).negate());
  }

  /** One member's receipt and own split, as their own rider view shows it. */
  private void assertMemberReceipt(
      Account member,
      UUID rideId,
      BigDecimal fare,
      String method,
      String paymentStatus,
      BigDecimal share,
      BigDecimal walletApplied) {
    JsonNode receipt =
        ok(get("/api/v1/rides/" + rideId + "/receipt", member.token()), HttpStatus.OK);
    assertThat(receipt.get("fare").get("components").get("total").decimalValue())
        .isEqualByComparingTo(fare);
    assertThat(receipt.get("paymentMethod").asText()).isEqualTo(method);
    assertThat(receipt.get("paymentStatus").asText()).isEqualTo("split");
    if (walletApplied == null) {
      assertThat(receipt.get("walletApplied").isNull()).isTrue();
    } else {
      assertThat(receipt.get("walletApplied").decimalValue()).isEqualByComparingTo(walletApplied);
    }
    JsonNode me = riderRide(member, rideId).get("shared").get("me");
    assertThat(me.get("shareAmount").decimalValue()).isEqualByComparingTo(share);
    assertThat(me.get("paymentStatus").asText()).isEqualTo(paymentStatus);
    assertThat(me.get("status").asText()).isEqualTo("completed");
  }

  private void registerDevice(Account account, String app) {
    String token = "fcm-m12-" + (++devices);
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
