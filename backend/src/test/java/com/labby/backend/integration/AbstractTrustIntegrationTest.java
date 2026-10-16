package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.DriverPerformanceService;
import com.labby.backend.service.RatingService;
import com.labby.backend.service.RatingSnapshotJob;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Shared fixture of the M11-T2 trust integration tests, on top of the ride/money fixture (active
 * Damascus region, controllable clock, real ride flows): direct ride / offer / rating fixtures at
 * controlled moments (so thresholds and windows are exercised exactly without hundreds of API
 * rides), parties without the online/streaming setup, and readers for outbox params, flags and role
 * states.
 */
abstract class AbstractTrustIntegrationTest extends AbstractMoneyIntegrationTest {

  @Autowired protected RatingService ratingService;
  @Autowired protected DriverPerformanceService driverPerformanceService;
  @Autowired protected RatingSnapshotJob ratingSnapshotJob;

  private int trustPhoneSequence;
  private int trustPlateSequence;

  @BeforeEach
  void resetTrustSequences() {
    trustPhoneSequence = 0;
    trustPlateSequence = 0;
  }

  /** A fresh rider account (no streaming setup). */
  protected Account newRider() {
    return registerWithoutPhoto(nextTrustPhone(), "Rana Rider");
  }

  /** An approved Economy driver, offline (fixtures do not need a position). */
  protected Account newDriver() {
    return approvedDriver(nextTrustPhone(), "TR-" + (++trustPlateSequence), economy, admin);
  }

  protected UUID vehicleOf(UUID driverUserId) {
    return jdbcTemplate.queryForObject(
        "SELECT vehicle_id FROM vehicles WHERE driver_user_id = ? AND is_active",
        UUID.class,
        driverUserId);
  }

  /** A completed fixture ride in the test region, completed at the given moment. */
  protected UUID completedRide(UUID riderUserId, UUID driverUserId, Instant completedAt) {
    return ride(
        riderUserId,
        driverUserId,
        "completed",
        completedAt.minusSeconds(1200),
        completedAt.minusSeconds(900),
        completedAt,
        null);
  }

  /**
   * A fixture ride with explicit lifecycle moments; the state's own timestamp must be set. A
   * cancelled state is stamped at {@code cancelledAt} with reason {@code vehicle_issue} (driver) /
   * {@code changed_mind} (rider).
   */
  protected UUID ride(
      UUID riderUserId,
      UUID driverUserId,
      String state,
      Instant acceptedAt,
      Instant arrivedAt,
      Instant completedAt,
      Instant cancelledAt) {
    UUID rideId = UUID.randomUUID();
    boolean cancelled = state.startsWith("cancelled");
    String reason =
        "cancelled_by_driver".equals(state)
            ? "vehicle_issue"
            : "cancelled_by_rider".equals(state) ? "changed_mind" : null;
    Instant requestedAt =
        acceptedAt != null ? acceptedAt.minusSeconds(60) : CLOCK.instant().minusSeconds(60);
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, driver_user_id, vehicle_id, region_id,"
            + " service_type_id, state, pickup, destination, payment_method,"
            + " pickup_distance_mode, currency, estimate_total, estimate_distance_m,"
            + " estimate_duration_s, estimate_components, requested_at, offering_at, accepted_at,"
            + " driver_arrived_at, started_at, completed_at, cancelled_at, cancellation_reason,"
            + " payment_status, no_driver_found_at) VALUES (?, ?, ?, ?, ?, ?, ?,"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.50), 4326), ST_SetSRID(ST_MakePoint(36.31,"
            + " 33.51), 4326), 'cash', 'nearby_only', 'SYP', 1.50, 2000, 300, '{}', ?, ?, ?, ?,"
            + " ?, ?, ?, ?, ?, ?)",
        rideId,
        riderUserId,
        driverUserId,
        driverUserId == null ? null : vehicleOf(driverUserId),
        regionId,
        economy,
        state,
        ts(requestedAt),
        ts(requestedAt),
        ts(acceptedAt),
        ts(arrivedAt),
        ts(completedAt == null ? null : completedAt.minusSeconds(600)),
        ts(completedAt),
        ts(cancelled ? cancelledAt : null),
        reason,
        "completed".equals(state) ? "pending" : null,
        ts("no_driver_found".equals(state) ? requestedAt.plusSeconds(600) : null));
    return rideId;
  }

  /** An offer of a ride to a driver, decided ({@code response}) or open (null). */
  protected void offer(
      UUID rideId, UUID driverUserId, Instant offeredAt, String response, int pickupEtaSeconds) {
    Integer sequence =
        jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ride_offers WHERE ride_id = ?",
            Integer.class,
            rideId);
    jdbcTemplate.update(
        "INSERT INTO ride_offers (ride_id, driver_user_id, vehicle_id, sequence,"
            + " pickup_distance_m, pickup_eta_s, offered_at, expires_at, response, responded_at)"
            + " VALUES (?, ?, ?, ?, 1000, ?, ?, ?, ?, ?)",
        rideId,
        driverUserId,
        vehicleOf(driverUserId),
        sequence,
        pickupEtaSeconds,
        ts(offeredAt),
        ts(offeredAt.plusSeconds(15)),
        response,
        ts(response == null ? null : offeredAt.plusSeconds(5)));
  }

  /** A rating row written directly (fixture history — no rule evaluation runs). */
  protected void fixtureRating(
      UUID rideId, UUID rater, String raterRole, UUID rated, String ratedRole, int score) {
    jdbcTemplate.update(
        "INSERT INTO ratings (ride_id, rater_user_id, rater_role, rated_user_id, rated_role,"
            + " score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        rideId,
        rater,
        raterRole,
        rated,
        ratedRole,
        score,
        ts(CLOCK.instant()));
  }

  /** {@code count} completed fixture rides rider -> driver, each rated by the rider with score. */
  protected void driverRatedTimes(Account rider, Account driver, int count, int score) {
    for (int i = 0; i < count; i++) {
      UUID rideId = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
      fixtureRating(rideId, rider.userId(), "rider", driver.userId(), "driver", score);
    }
  }

  /** {@code count} completed fixture rides, each rider rated by the driver with score. */
  protected void riderRatedTimes(Account rider, Account driver, int count, int score) {
    for (int i = 0; i < count; i++) {
      UUID rideId = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
      fixtureRating(rideId, driver.userId(), "driver", rider.userId(), "rider", score);
    }
  }

  protected ResponseEntity<JsonNode> rate(Account caller, UUID rideId, Object score) {
    return post("/api/v1/rides/" + rideId + "/rating", Map.of("score", score), caller.token());
  }

  /** Rates via the API (204 expected) — the rule evaluation runs. */
  protected void rateOk(Account caller, UUID rideId, int score) {
    ResponseEntity<JsonNode> response = rate(caller, rideId, score);
    assertThat(response.getStatusCode())
        .as("%s", response.getBody())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  /**
   * The daily trust pass (snapshots + USR-05 / RATE-03): since review B-H1 the rules never run on a
   * stored rating, only here.
   */
  protected void dailyJob() {
    ratingSnapshotJob.run();
  }

  /** Rates via the API, then runs the daily pass — the earliest moment the rules can fire. */
  protected void rateAndEvaluate(Account caller, UUID rideId, int score) {
    rateOk(caller, rideId, score);
    dailyJob();
  }

  protected Map<String, Object> roleRow(UUID userId, String role) {
    return jdbcTemplate.queryForMap(
        "SELECT state, suspension_reason, suspension_note, suspended_at FROM role_assignments"
            + " WHERE user_id = ? AND role = ?",
        userId,
        role);
  }

  protected List<Map<String, Object>> flags(UUID userId) {
    return jdbcTemplate.queryForList(
        "SELECT kind, role, status, details::text AS details FROM account_flags WHERE user_id = ?"
            + " ORDER BY raised_at, account_flag_id",
        userId);
  }

  /** The params JSON of the user's outbox entries of one event, oldest first. */
  protected List<String> outboxParams(UUID userId, String event) {
    return jdbcTemplate.queryForList(
        "SELECT params::text FROM notification_outbox WHERE user_id = ? AND event = ?"
            + " ORDER BY created_at",
        String.class,
        userId,
        event);
  }

  protected String supportAdmin(String phone) {
    return registerAdmin(phone, com.labby.backend.util.RbacIds.SUPPORT_ROLE_ID);
  }

  /** An admin whose custom RBAC role holds no permission at all. */
  protected String powerlessAdmin(String phone) {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name, is_system) VALUES (?, false) RETURNING role_id",
            UUID.class,
            "Powerless " + phone);
    return registerAdmin(phone, roleId);
  }

  protected static Timestamp ts(Instant instant) {
    return instant == null ? null : Timestamp.from(instant);
  }

  private String nextTrustPhone() {
    return "+9639376%05d".formatted(++trustPhoneSequence);
  }
}
