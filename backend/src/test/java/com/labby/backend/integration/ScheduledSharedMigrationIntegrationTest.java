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
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M12-T1 acceptance: V19 migrates cleanly and the scheduled/shared invariants hold at the DATABASE
 * level — the pre-live states belong to their kind, hold no driver and never count as the rider's
 * active ride (RIDE-S1, RIDE-P1); a claim is all-or-nothing, a scheduled ride either converts or
 * falls back, released claims are an append-only trail (RIDE-S2..4, UC-D-12 E1); weekly
 * availability windows are well-formed (DRV-05); shared seats can never be oversold (the last-seat
 * backstop), departure rules and member lifecycles are consistent, one creator per ride
 * (RIDE-P1..5); money and ratings are unique per ride x member instead of per ride (RIDE-P4) while
 * one-rider rides keep their old uniqueness; region scheduled settings are an object.
 */
class ScheduledSharedMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID rider;
  private UUID joiner;
  private UUID driver;
  private UUID vehicle;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Scheduled IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    rider = newUser();
    joiner = newUser();
    driver = newUser();
    vehicle = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'DM-M12', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
  }

  @AfterEach
  void cleanOwnRows() {
    // Ledgers, ratings and the claim-release trail refuse DELETE by trigger; TRUNCATE bypasses
    // row-level triggers (same approach as the money and trust migration tests).
    jdbcTemplate.execute("TRUNCATE driver_ledger, wallet_transactions, settlements");
    jdbcTemplate.execute("TRUNCATE ratings");
    jdbcTemplate.execute("TRUNCATE scheduled_claim_releases");
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM rider_dues WHERE rider_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM availability_windows WHERE driver_user_id = ?", userId);
    }
    jdbcTemplate.update(
        "DELETE FROM shared_ride_members WHERE ride_id IN (SELECT ride_id FROM rides WHERE"
            + " region_id = ?)",
        regionId);
    jdbcTemplate.update(
        "DELETE FROM shared_rides WHERE ride_id IN (SELECT ride_id FROM rides WHERE region_id ="
            + " ?)",
        regionId);
    jdbcTemplate.update(
        "DELETE FROM scheduled_rides WHERE ride_id IN (SELECT ride_id FROM rides WHERE region_id"
            + " = ?)",
        regionId);
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM vehicles WHERE vehicle_id = ?", vehicle);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("RIDE-S1/P1: pre-live states belong to their kind, hold no driver, never block")
  void shouldScopePreLiveStates() {
    UUID scheduled = insertRide(joiner, "scheduled", "scheduled");
    insertRide(rider, "scheduled", "scheduled");
    insertRide(rider, "shared", "gathering");
    // A rider waiting on a scheduled and a shared ride may still book on demand (UC-R-04 E4
    // counts live rides only).
    insertRide(rider, "on_demand", "requested");
    assertThatThrownBy(() -> insertRide(rider, "on_demand", "scheduled"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_kind_state");
    assertThatThrownBy(() -> insertRide(rider, "scheduled", "gathering"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_kind_state");
    // The claim lives on scheduled_rides; the ride row binds a driver only from `accepted`.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET driver_user_id = ?, vehicle_id = ? WHERE ride_id = ?",
                    driver,
                    vehicle,
                    scheduled))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_driver_bound");
    // Conversion: scheduled -> accepted with the claimed driver bound.
    jdbcTemplate.update(
        "UPDATE rides SET state = 'accepted', accepted_at = now(), driver_user_id = ?,"
            + " vehicle_id = ? WHERE ride_id = ?",
        driver,
        vehicle,
        scheduled);
    // The system's shared expiry is a recorded cancellation reason.
    UUID expired = insertRide(joiner, "shared", "gathering");
    jdbcTemplate.update(
        "UPDATE rides SET state = 'cancelled_by_rider', cancelled_at = now(),"
            + " cancellation_reason = 'shared_expired' WHERE ride_id = ?",
        expired);
  }

  @Test
  @DisplayName("RIDE-S2..4: a claim is all-or-nothing; a ride converts or falls back, not both")
  void shouldEnforceScheduledClaimShape() {
    UUID ride = insertScheduled(rider);
    // Half a claim is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE scheduled_rides SET claimed_driver_user_id = ? WHERE ride_id = ?",
                    driver,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_rides_claim");
    // Driver reminder marks need a claim.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE scheduled_rides SET driver_reminder_first_at = now() WHERE ride_id ="
                        + " ?",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_rides_driver_reminders");
    // Only a claimed ride converts; an unclaimed one falls back.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE scheduled_rides SET converted_at = now() WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_rides_converted");
    claim(ride);
    jdbcTemplate.update(
        "UPDATE scheduled_rides SET driver_reminder_first_at = now(),"
            + " rider_reminder_first_at = now() WHERE ride_id = ?",
        ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE scheduled_rides SET fallback_at = now() WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_rides_fallback");
    jdbcTemplate.update("UPDATE scheduled_rides SET converted_at = now() WHERE ride_id = ?", ride);

    UUID unclaimed = insertScheduled(joiner);
    jdbcTemplate.update(
        "UPDATE scheduled_rides SET fallback_at = now() WHERE ride_id = ?", unclaimed);
    assertThatThrownBy(() -> claim(unclaimed))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_rides_fallback");
  }

  @Test
  @DisplayName("UC-D-12 E1: released claims are a reasoned, append-only trail")
  void shouldKeepClaimReleaseTrail() {
    UUID ride = insertScheduled(rider);
    UUID release = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO scheduled_claim_releases (scheduled_claim_release_id, ride_id,"
            + " driver_user_id, claimed_at, reason) VALUES (?, ?, ?, now() - interval '1 hour',"
            + " 'vehicle_issue')",
        release,
        ride,
        driver);
    assertThatThrownBy(() -> insertRelease(ride, "other", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_claim_releases_note");
    assertThatThrownBy(() -> insertRelease(ride, "rider_no_show", null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_scheduled_claim_releases_reason");
    insertRelease(ride, "other", "Family emergency");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "DELETE FROM scheduled_claim_releases WHERE scheduled_claim_release_id = ?",
                    release))
        .isInstanceOf(DataAccessException.class)
        .hasMessageContaining("append-only");
  }

  @Test
  @DisplayName("DRV-05: weekly availability windows are ISO weekdays, no duplicate rows")
  void shouldEnforceAvailabilityWindows() {
    insertWindow(1, "08:00", "12:00");
    // Overnight (end < start) and whole-day (start = end) windows are allowed shapes.
    insertWindow(5, "22:00", "02:00");
    insertWindow(7, "00:00", "00:00");
    assertThatThrownBy(() -> insertWindow(1, "08:00", "12:00"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_availability_windows");
    for (int day : new int[] {0, 8}) {
      assertThatThrownBy(() -> insertWindow(day, "08:00", "12:00"))
          .isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("ck_availability_windows_day");
    }
  }

  @Test
  @DisplayName("RIDE-P1..3: seats are never oversold; departure and dispatch shapes hold")
  void shouldEnforceSharedRideShape() {
    UUID ride = insertShared(rider, 4, 2);
    // Last-seat backstop: taking more seats than offered fails at the database.
    jdbcTemplate.update("UPDATE shared_rides SET seats_taken = 4 WHERE ride_id = ?", ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_rides SET seats_taken = 5 WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_rides_seats_taken");
    for (int seats : new int[] {1, 9}) {
      assertThatThrownBy(() -> insertShared(joiner, seats, 1))
          .isInstanceOf(DataIntegrityViolationException.class)
          .hasMessageContaining("ck_shared_rides_total_seats");
    }
    // A timed ride has a departure and no expiry; a "when full" ride the opposite.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_rides SET expires_at = now() WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_rides_departure");
    jdbcTemplate.update(
        "UPDATE shared_rides SET departure_mode = 'when_full', departure_at = NULL,"
            + " expires_at = now() + interval '24 hours' WHERE ride_id = ?",
        ride);
    // A dispatch records its trigger and moment together.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_rides SET dispatch_trigger = 'full' WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_rides_dispatched");
    jdbcTemplate.update(
        "UPDATE shared_rides SET dispatch_trigger = 'full', dispatched_at = now() WHERE ride_id"
            + " = ?",
        ride);
    // The split divides by boarded seats, never more than offered.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_rides SET split_seats = 5, per_seat_amount = 1.00 WHERE"
                        + " ride_id = ?",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_rides_split");
    jdbcTemplate.update(
        "UPDATE shared_rides SET split_seats = 3, per_seat_amount = 1.25 WHERE ride_id = ?", ride);
  }

  @Test
  @DisplayName("RIDE-P2/P5: one creator, one live membership, consistent member lifecycle")
  void shouldEnforceMemberLifecycle() {
    UUID ride = insertShared(rider, 4, 1);
    insertMember(ride, rider, true, 1);
    assertThatThrownBy(() -> insertMember(ride, joiner, true, 1))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_shared_ride_members_creator");
    UUID first = insertMember(ride, joiner, false, 2);
    assertThatThrownBy(() -> insertMember(ride, joiner, false, 1))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_shared_ride_members_live");
    // Leaving needs its moment; a member who left before dispatch may join again.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_ride_members SET status = 'left' WHERE"
                        + " shared_ride_member_id = ?",
                    first))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_ride_members_left");
    jdbcTemplate.update(
        "UPDATE shared_ride_members SET status = 'left', left_at = now() WHERE"
            + " shared_ride_member_id = ?",
        first);
    UUID again = insertMember(ride, joiner, false, 1);
    // Leaving before dispatch is free; a post-dispatch cancel carries a reason.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_ride_members SET cancellation_fee = 2.00 WHERE"
                        + " shared_ride_member_id = ?",
                    first))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_ride_members_fee");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_ride_members SET status = 'cancelled', left_at = now() WHERE"
                        + " shared_ride_member_id = ?",
                    again))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_ride_members_cancellation");
    // A no-show pays the fee and has no share; a completed member has a share + payment.
    jdbcTemplate.update(
        "UPDATE shared_ride_members SET status = 'no_show', no_show_at = now(),"
            + " cancellation_fee = 2.00 WHERE shared_ride_member_id = ?",
        again);
    assertThatThrownBy(() -> insertMember(ride, newUser(), false, 0))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_ride_members_party");
    UUID creator =
        jdbcTemplate.queryForObject(
            "SELECT shared_ride_member_id FROM shared_ride_members WHERE ride_id = ? AND"
                + " is_creator",
            UUID.class,
            ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE shared_ride_members SET status = 'completed' WHERE"
                        + " shared_ride_member_id = ?",
                    creator))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_shared_ride_members_share");
    jdbcTemplate.update(
        "UPDATE shared_ride_members SET status = 'completed', share_amount = 3.75,"
            + " payment_status = 'paid_wallet', payment_confirmed_at = now() WHERE"
            + " shared_ride_member_id = ?",
        creator);
  }

  @Test
  @DisplayName("RIDE-P4: a completed shared ride is paid per member; others keep ride statuses")
  void shouldSplitPaymentStatusByKind() {
    UUID shared = insertShared(rider, 2, 1);
    assertThatThrownBy(() -> completeRide(shared, "pending"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_payment_status");
    completeRide(shared, "split");
    UUID onDemand = insertRide(joiner, "on_demand", "requested");
    assertThatThrownBy(() -> completeRide(onDemand, "split"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_payment_status");
    completeRide(onDemand, "pending");
  }

  @Test
  @DisplayName("RIDE-P4: fare, tip, fee, dues and ratings are unique per ride x member")
  void shouldScopeMoneyAndRatingsPerMember() {
    UUID ride = insertShared(rider, 4, 2);
    completeRide(ride, "split");
    UUID creatorMember = insertMember(ride, rider, true, 1);
    UUID joinerMember = insertMember(ride, joiner, false, 1);
    // One fare entry per member; a second for the same member is refused.
    insertFareEntry(ride, creatorMember);
    insertFareEntry(ride, joinerMember);
    assertThatThrownBy(() -> insertFareEntry(ride, joinerMember))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_ledger_ride_fare");
    // A one-rider ride (member NULL) still posts exactly one fare entry.
    UUID single = insertRide(newUser(), "on_demand", "requested");
    completeRide(single, "pending");
    insertFareEntry(single, null);
    assertThatThrownBy(() -> insertFareEntry(single, null))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_driver_ledger_ride_fare");
    // Each member tips once.
    insertGrant(rider);
    insertGrant(joiner);
    insertTip(rider, ride);
    insertTip(joiner, ride);
    assertThatThrownBy(() -> insertTip(joiner, ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_wallet_transactions_tip");
    // Each member may owe their own due from the same ride.
    insertDue(rider, ride);
    insertDue(joiner, ride);
    assertThatThrownBy(() -> insertDue(joiner, ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_rider_dues_source");
    // Each member rates the driver; the driver rates each member; never twice per pair.
    insertRating(ride, rider, "rider", driver, "driver");
    insertRating(ride, joiner, "rider", driver, "driver");
    insertRating(ride, driver, "driver", rider, "rider");
    insertRating(ride, driver, "driver", joiner, "rider");
    assertThatThrownBy(() -> insertRating(ride, joiner, "rider", driver, "driver"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ratings_ride_rater_rated");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM ratings WHERE ride_id = ?", Integer.class, ride))
        .isEqualTo(4);
  }

  @Test
  @DisplayName("RIDE-S: region scheduled settings default to NULL and must be an object")
  void shouldValidateRegionScheduledSettings() {
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT scheduled_settings IS NULL FROM regions WHERE region_id = ?",
                Boolean.class,
                regionId))
        .isTrue();
    jdbcTemplate.update(
        "UPDATE regions SET scheduled_settings = '{\"fallbackLeadMin\": 20}' WHERE region_id = ?",
        regionId);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE regions SET scheduled_settings = '[15]' WHERE region_id = ?", regionId))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_regions_scheduled_settings");
  }

  private UUID insertRide(UUID riderId, String kind, String state) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, kind, state,"
            + " pickup, destination, payment_method, pickup_distance_mode, currency,"
            + " estimate_total, estimate_distance_m, estimate_duration_s, estimate_components)"
            + " VALUES (?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId,
        kind,
        state);
    return rideId;
  }

  private UUID insertScheduled(UUID riderId) {
    UUID rideId = insertRide(riderId, "scheduled", "scheduled");
    jdbcTemplate.update(
        "INSERT INTO scheduled_rides (ride_id, scheduled_at) VALUES (?, now() + interval '2"
            + " days')",
        rideId);
    return rideId;
  }

  private void claim(UUID rideId) {
    jdbcTemplate.update(
        "UPDATE scheduled_rides SET claimed_driver_user_id = ?, claimed_vehicle_id = ?,"
            + " claimed_at = now() WHERE ride_id = ?",
        driver,
        vehicle,
        rideId);
  }

  private void insertRelease(UUID rideId, String reason, String note) {
    jdbcTemplate.update(
        "INSERT INTO scheduled_claim_releases (ride_id, driver_user_id, claimed_at, reason, note)"
            + " VALUES (?, ?, now() - interval '1 hour', ?, ?)",
        rideId,
        driver,
        reason,
        note);
  }

  private void insertWindow(int day, String startsAt, String endsAt) {
    jdbcTemplate.update(
        "INSERT INTO availability_windows (driver_user_id, day_of_week, starts_at, ends_at)"
            + " VALUES (?, ?, ?::time, ?::time)",
        driver,
        day,
        startsAt,
        endsAt);
  }

  private UUID insertShared(UUID creatorId, int totalSeats, int seatsTaken) {
    UUID rideId = insertRide(creatorId, "shared", "gathering");
    jdbcTemplate.update(
        "INSERT INTO shared_rides (ride_id, total_seats, seats_taken, departure_mode,"
            + " departure_at) VALUES (?, ?, ?, 'at_time', now() + interval '1 hour')",
        rideId,
        totalSeats,
        seatsTaken);
    return rideId;
  }

  private UUID insertMember(UUID rideId, UUID riderId, boolean creator, int partySize) {
    UUID memberId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO shared_ride_members (shared_ride_member_id, ride_id, rider_user_id,"
            + " is_creator, party_size, payment_method) VALUES (?, ?, ?, ?, ?, 'cash')",
        memberId,
        rideId,
        riderId,
        creator,
        partySize);
    return memberId;
  }

  /** Moves a pre-live ride straight to completed with the driver bound (shape only). */
  private void completeRide(UUID rideId, String paymentStatus) {
    jdbcTemplate.update(
        "UPDATE rides SET state = 'completed', driver_user_id = ?, vehicle_id = ?, offering_at ="
            + " now(), accepted_at = now(), driver_arrived_at = now(), started_at = now(),"
            + " completed_at = now(), payment_status = ? WHERE ride_id = ?",
        driver,
        vehicle,
        paymentStatus,
        rideId);
  }

  private void insertFareEntry(UUID rideId, UUID memberId) {
    jdbcTemplate.update(
        "INSERT INTO driver_ledger (driver_user_id, currency, amount, type, ride_id,"
            + " shared_ride_member_id, fare_amount, commission_rate, commission_amount,"
            + " balance_after) VALUES (?, 'SYP', -0.50, 'commission_due', ?, ?, 2.00, 25.00, 0.50,"
            + " -0.50)",
        driver,
        rideId,
        memberId);
  }

  private void insertGrant(UUID userId) {
    jdbcTemplate.update(
        "INSERT INTO wallet_transactions (user_id, currency, amount, type, created_by, reason,"
            + " balance_after) VALUES (?, 'SYP', 10.00, 'admin_grant', ?, 'seed', 10.00)",
        userId,
        driver);
  }

  private void insertTip(UUID userId, UUID rideId) {
    jdbcTemplate.update(
        "INSERT INTO wallet_transactions (user_id, currency, amount, type, ride_id,"
            + " balance_after) VALUES (?, 'SYP', -1.00, 'tip', ?, 9.00)",
        userId,
        rideId);
  }

  private void insertDue(UUID riderId, UUID rideId) {
    jdbcTemplate.update(
        "INSERT INTO rider_dues (rider_user_id, currency, amount, source_ride_id) VALUES (?,"
            + " 'SYP', 2.00, ?)",
        riderId,
        rideId);
  }

  private void insertRating(
      UUID rideId, UUID raterId, String raterRole, UUID ratedId, String ratedRole) {
    jdbcTemplate.update(
        "INSERT INTO ratings (ride_id, rater_user_id, rater_role, rated_user_id, rated_role,"
            + " score) VALUES (?, ?, ?, ?, ?, 5)",
        rideId,
        raterId,
        raterRole,
        ratedId,
        ratedRole);
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Scheduled Test User', now())",
        userId,
        "+9637%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
