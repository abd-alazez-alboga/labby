package com.labby.backend.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The DRV-08 week figures (incentives-v1 rulings Q1/Q4/Q5): completed rides the driver drove in a
 * region, by completion time in {@code [from, to)}; ratings on those rides. An optional driver
 * narrows to one driver (the live progress), otherwise every driver of the region (the job). A
 * trip's peak moment is the one surcharge pricing used (Q1): a scheduled ride's pickup time ({@code
 * scheduled_rides.scheduled_at}), otherwise {@code requested_at}.
 */
@Repository
@RequiredArgsConstructor
public class IncentiveStatsRepository {

  private static final String WEEK_RIDES =
      " WHERE r.region_id = :regionId AND r.state = 'completed' AND r.driver_user_id IS NOT NULL"
          + " AND r.completed_at >= :from AND r.completed_at < :to";

  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /**
   * One completed trip: its driver and the moment its surcharge was priced at (peak windows use it,
   * Q1) — the pickup time of a scheduled ride, the request time otherwise.
   */
  public record CompletedTrip(UUID driverUserId, Instant pricedAt) {}

  /** A driver's week ratings: the exact average and how many. */
  public record RatingStats(UUID driverUserId, BigDecimal average, long count) {}

  /**
   * The week's completed trips.
   *
   * @param regionId the region
   * @param from completion lower bound (inclusive)
   * @param to completion upper bound (exclusive)
   * @param driverUserId one driver, or null for all
   * @return the trips
   */
  public List<CompletedTrip> completedTrips(
      UUID regionId, Instant from, Instant to, UUID driverUserId) {
    MapSqlParameterSource params = params(regionId, from, to, driverUserId);
    return namedJdbcTemplate.query(
        "SELECT r.driver_user_id, COALESCE(sr.scheduled_at, r.requested_at) AS priced_at"
            + " FROM rides r LEFT JOIN scheduled_rides sr ON sr.ride_id = r.ride_id"
            + WEEK_RIDES
            + driverClause(driverUserId),
        params,
        (rs, i) ->
            new CompletedTrip(
                rs.getObject("driver_user_id", UUID.class),
                rs.getObject("priced_at", OffsetDateTime.class).toInstant()));
  }

  /**
   * Ratings drivers received on the week's completed rides, per driver (Q4) — only ratings given
   * before the week ended, so the payout does not depend on which hourly tick evaluates the week (a
   * rating left on Monday for a Sunday ride counts for nothing, as with the single Monday run).
   *
   * @param regionId the region
   * @param from completion lower bound (inclusive)
   * @param to completion upper bound (exclusive)
   * @param driverUserId one driver, or null for all
   * @return one row per rated driver
   */
  public List<RatingStats> ratingStats(UUID regionId, Instant from, Instant to, UUID driverUserId) {
    MapSqlParameterSource params = params(regionId, from, to, driverUserId);
    return namedJdbcTemplate.query(
        "SELECT r.driver_user_id, AVG(ra.score) AS average, COUNT(*) AS n FROM rides r"
            + " JOIN ratings ra ON ra.ride_id = r.ride_id AND ra.rated_role = 'driver'"
            + " AND ra.rated_user_id = r.driver_user_id AND ra.created_at < :to"
            + WEEK_RIDES
            + driverClause(driverUserId)
            + " GROUP BY r.driver_user_id",
        params,
        (rs, i) ->
            new RatingStats(
                rs.getObject("driver_user_id", UUID.class),
                rs.getBigDecimal("average"),
                rs.getLong("n")));
  }

  /**
   * The nightly weekly rating view of one driver (V1 conformance H5): the stored average and when
   * it was computed — the count stays internal.
   */
  public record WeekRatingSnapshot(BigDecimal average, int count, Instant computedAt) {}

  /**
   * Rewrites the region's weekly rating snapshots for the week in {@code [from, to)} from the
   * ratings stored so far (the same rows {@link #ratingStats} reads), under the RATE-02 rule (owner
   * ruling 2026-10-16, applied to incentives by the owner ruling 2026-10-20): only where no
   * snapshot exists yet, at least {@code minNew} ratings arrived since the stored one, or on the
   * first exposure (stored count below {@code exposeFrom}, live at or above it). The average is
   * stored with 2 decimals rounded DOWN (the incentives display rule).
   *
   * @param regionId the region
   * @param weekStart the week's region-local Monday
   * @param from completion lower bound (inclusive)
   * @param to completion upper bound (exclusive)
   * @param now the snapshot moment
   * @param minNew the minimum new ratings for a rewrite (3)
   * @param exposeFrom the exposure minimum (5)
   * @return the rows written
   */
  public int rewriteWeekSnapshots(
      UUID regionId,
      LocalDate weekStart,
      Instant from,
      Instant to,
      Instant now,
      int minNew,
      int exposeFrom) {
    MapSqlParameterSource params =
        params(regionId, from, to, null)
            .addValue("weekStart", weekStart)
            .addValue("now", OffsetDateTime.ofInstant(now, ZoneOffset.UTC))
            .addValue("minNew", minNew)
            .addValue("exposeFrom", exposeFrom);
    return namedJdbcTemplate.update(
        "INSERT INTO incentive_rating_snapshots"
            + " (driver_user_id, region_id, week_start, avg_rating, rating_count, computed_at)"
            + " SELECT a.driver_user_id, :regionId, :weekStart, TRUNC(a.average, 2), a.n, :now"
            + " FROM (SELECT r.driver_user_id, AVG(ra.score) AS average, COUNT(*) AS n FROM rides r"
            + " JOIN ratings ra ON ra.ride_id = r.ride_id AND ra.rated_role = 'driver'"
            + " AND ra.rated_user_id = r.driver_user_id AND ra.created_at < :to"
            + WEEK_RIDES
            + " GROUP BY r.driver_user_id) a"
            + " LEFT JOIN incentive_rating_snapshots s ON s.driver_user_id = a.driver_user_id"
            + " AND s.region_id = :regionId AND s.week_start = :weekStart"
            + " WHERE s.driver_user_id IS NULL OR a.n - s.rating_count >= :minNew"
            + " OR (s.rating_count < :exposeFrom AND a.n >= :exposeFrom)"
            + " ON CONFLICT (driver_user_id, region_id, week_start) DO UPDATE"
            + " SET avg_rating = EXCLUDED.avg_rating, rating_count = EXCLUDED.rating_count,"
            + " computed_at = EXCLUDED.computed_at",
        params);
  }

  /**
   * One driver's nightly weekly rating snapshot.
   *
   * @param regionId the region
   * @param weekStart the week's region-local Monday
   * @param driverUserId the driver
   * @return the snapshot, empty before the first nightly pass that saw a rating
   */
  public Optional<WeekRatingSnapshot> weekSnapshot(
      UUID regionId, LocalDate weekStart, UUID driverUserId) {
    return namedJdbcTemplate
        .query(
            "SELECT avg_rating, rating_count, computed_at FROM incentive_rating_snapshots"
                + " WHERE driver_user_id = :driverUserId AND region_id = :regionId"
                + " AND week_start = :weekStart",
            new MapSqlParameterSource()
                .addValue("driverUserId", driverUserId)
                .addValue("regionId", regionId)
                .addValue("weekStart", weekStart),
            (rs, i) ->
                new WeekRatingSnapshot(
                    rs.getBigDecimal("avg_rating"),
                    rs.getInt("rating_count"),
                    rs.getObject("computed_at", OffsetDateTime.class).toInstant()))
        .stream()
        .findFirst();
  }

  private static String driverClause(UUID driverUserId) {
    return driverUserId == null ? "" : " AND r.driver_user_id = :driverUserId";
  }

  private static MapSqlParameterSource params(
      UUID regionId, Instant from, Instant to, UUID driverUserId) {
    return new MapSqlParameterSource()
        .addValue("regionId", regionId)
        .addValue("from", OffsetDateTime.ofInstant(from, ZoneOffset.UTC))
        .addValue("to", OffsetDateTime.ofInstant(to, ZoneOffset.UTC))
        .addValue("driverUserId", driverUserId);
  }
}
