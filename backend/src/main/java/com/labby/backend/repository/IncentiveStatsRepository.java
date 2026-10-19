package com.labby.backend.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The DRV-08 week figures (incentives-v1 rulings Q1/Q4/Q5): completed rides the driver drove in a
 * region, by completion time in {@code [from, to)}; ratings on those rides. An optional driver
 * narrows to one driver (the live progress), otherwise every driver of the region (the job).
 */
@Repository
@RequiredArgsConstructor
public class IncentiveStatsRepository {

  private static final String WEEK_RIDES =
      " WHERE r.region_id = :regionId AND r.state = 'completed' AND r.driver_user_id IS NOT NULL"
          + " AND r.completed_at >= :from AND r.completed_at < :to";

  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /** One completed trip: its driver and request time (peak windows use the request, Q1). */
  public record CompletedTrip(UUID driverUserId, Instant requestedAt) {}

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
        "SELECT r.driver_user_id, r.requested_at FROM rides r"
            + WEEK_RIDES
            + driverClause(driverUserId),
        params,
        (rs, i) ->
            new CompletedTrip(
                rs.getObject("driver_user_id", UUID.class),
                rs.getObject("requested_at", OffsetDateTime.class).toInstant()));
  }

  /**
   * Ratings drivers received on the week's completed rides, per driver (Q4).
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
            + " AND ra.rated_user_id = r.driver_user_id"
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
