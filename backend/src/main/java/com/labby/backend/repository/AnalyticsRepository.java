package com.labby.backend.repository;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The M15 dashboard aggregates (analytics-v1.yaml, ADM-02). Plain SQL: every figure is one grouped
 * statement over indexed columns (V30). Ride figures select rides by {@code requested_at} in {@code
 * [from, to)}; an optional region narrows by {@code rides.region_id}. Callers run inside a
 * read-only transaction and bound it with {@link #limitStatementTime} first.
 */
@Repository
@RequiredArgsConstructor
public class AnalyticsRepository {

  private static final String RIDES_IN_RANGE =
      " WHERE r.requested_at >= :from AND r.requested_at < :to";

  /**
   * The driver of {@code p} (a {@code driver_profiles} alias) has an active vehicle serving a
   * service type of {@code :regionId} — the drivers' region (they carry no region column).
   */
  static final String ACTIVE_VEHICLE_IN_REGION =
      """
      EXISTS (SELECT 1 FROM vehicles v
              JOIN vehicle_service_types vst ON vst.vehicle_id = v.vehicle_id
              JOIN service_types s ON s.service_type_id = vst.service_type_id
              WHERE v.driver_user_id = p.user_id AND v.is_active AND s.region_id = :regionId)
      """;

  private final JdbcTemplate jdbcTemplate;
  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /** Ride count per region, service type and state. */
  public record RideStateCount(
      UUID regionId,
      String regionName,
      UUID serviceTypeId,
      String serviceTypeNameEn,
      String serviceTypeNameAr,
      String state,
      long count) {}

  /** Ride counts of one local day. */
  public record DailyCount(LocalDate date, long total, long completed, long cancelled) {}

  /** Fares and commission of one region's completed rides in one currency. */
  public record RegionRevenue(
      UUID regionId,
      String regionName,
      String currency,
      BigDecimal grossFares,
      BigDecimal commission) {}

  /** Accounts created in the range holding each role. */
  public record Signups(long riders, long drivers) {}

  /** Distinct parties with a completed ride. */
  public record ActiveParties(long riders, long drivers) {}

  /** Offers answered in the range. */
  public record OfferCounts(long accepted, long answered) {}

  /**
   * Bounds every later statement of the CURRENT transaction (PostgreSQL {@code SET LOCAL
   * statement_timeout}); a statement that runs longer is cancelled (SQLSTATE 57014).
   *
   * @param limit the per-statement limit
   */
  public void limitStatementTime(Duration limit) {
    jdbcTemplate.execute("SET LOCAL statement_timeout = " + Math.max(1, limit.toMillis()));
  }

  /**
   * Ride counts per region, service type and state.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return the counts
   */
  public List<RideStateCount> rideStateCounts(Instant from, Instant to, UUID regionId) {
    return namedJdbcTemplate.query(
        """
        SELECT r.region_id, g.name AS region_name, r.service_type_id, s.name_en, s.name_ar,
               r.state, COUNT(*) AS n
        FROM rides r
        JOIN regions g ON g.region_id = r.region_id
        JOIN service_types s ON s.service_type_id = r.service_type_id
        """
            + RIDES_IN_RANGE
            + regionClause(regionId)
            + " GROUP BY r.region_id, g.name, r.service_type_id, s.name_en, s.name_ar, r.state",
        params(from, to, regionId),
        (rs, i) ->
            new RideStateCount(
                rs.getObject("region_id", UUID.class),
                rs.getString("region_name"),
                rs.getObject("service_type_id", UUID.class),
                rs.getString("name_en"),
                rs.getString("name_ar"),
                rs.getString("state"),
                rs.getLong("n")));
  }

  /**
   * Ride counts per local day, the day taken in each ride's region time zone.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return the days with rides, oldest first
   */
  public List<DailyCount> dailyCounts(Instant from, Instant to, UUID regionId) {
    return namedJdbcTemplate.query(
        """
        SELECT (r.requested_at AT TIME ZONE g.time_zone)::date AS day, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE r.state = 'completed') AS completed,
               COUNT(*) FILTER (WHERE r.state IN ('cancelled_by_rider', 'cancelled_by_driver'))
                   AS cancelled
        FROM rides r
        JOIN regions g ON g.region_id = r.region_id
        """
            + RIDES_IN_RANGE
            + regionClause(regionId)
            + " GROUP BY day ORDER BY day",
        params(from, to, regionId),
        (rs, i) ->
            new DailyCount(
                rs.getObject("day", Date.class).toLocalDate(),
                rs.getLong("total"),
                rs.getLong("completed"),
                rs.getLong("cancelled")));
  }

  /**
   * Final fares and the ledger commission of the completed rides, per region and currency. The
   * commission is the sum of the rides' fare entries ({@code ride_earning} / {@code
   * commission_due}, COM-01), looked up per ride through {@code idx_driver_ledger_ride}.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return the rows, by region name then currency
   */
  public List<RegionRevenue> regionRevenue(Instant from, Instant to, UUID regionId) {
    return namedJdbcTemplate.query(
        """
        SELECT r.region_id, g.name AS region_name, f.currency, SUM(f.total) AS gross,
               COALESCE(SUM(c.commission), 0) AS commission
        FROM rides r
        JOIN regions g ON g.region_id = r.region_id
        JOIN fares f ON f.ride_id = r.ride_id
        LEFT JOIN LATERAL (
            SELECT SUM(l.commission_amount) AS commission FROM driver_ledger l
            WHERE l.ride_id = r.ride_id AND l.type IN ('ride_earning', 'commission_due')) c ON true
        """
            + RIDES_IN_RANGE
            + " AND r.state = 'completed'"
            + regionClause(regionId)
            + " GROUP BY r.region_id, g.name, f.currency ORDER BY g.name, r.region_id, f.currency",
        params(from, to, regionId),
        (rs, i) ->
            new RegionRevenue(
                rs.getObject("region_id", UUID.class),
                rs.getString("region_name"),
                rs.getString("currency"),
                rs.getBigDecimal("gross"),
                rs.getBigDecimal("commission")));
  }

  /**
   * Accounts created in the range holding the rider / driver role (any role state). Platform-wide:
   * users carry no region (ruling Q6).
   *
   * @param from inclusive
   * @param to exclusive
   * @return the counts
   */
  public Signups signups(Instant from, Instant to) {
    return namedJdbcTemplate.queryForObject(
        """
        SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM role_assignments a
                   WHERE a.user_id = u.user_id AND a.role = 'rider')) AS riders,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM role_assignments a
                   WHERE a.user_id = u.user_id AND a.role = 'driver')) AS drivers
        FROM users u
        WHERE u.created_at >= :from AND u.created_at < :to
        """,
        params(from, to, null),
        (rs, i) -> new Signups(rs.getLong("riders"), rs.getLong("drivers")));
  }

  /**
   * Distinct riders and drivers with at least one completed ride in the range.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return the counts
   */
  public ActiveParties activeParties(Instant from, Instant to, UUID regionId) {
    return namedJdbcTemplate.queryForObject(
        "SELECT COUNT(DISTINCT r.rider_user_id) AS riders,"
            + " COUNT(DISTINCT r.driver_user_id) AS drivers FROM rides r"
            + RIDES_IN_RANGE
            + " AND r.state = 'completed'"
            + regionClause(regionId),
        params(from, to, regionId),
        (rs, i) -> new ActiveParties(rs.getLong("riders"), rs.getLong("drivers")));
  }

  /**
   * Drivers flagged online now; with a region, those whose active vehicle serves a service type of
   * it (point in time, ruling Q3).
   *
   * @param regionId optional region
   * @return the count
   */
  public long driversOnlineNow(UUID regionId) {
    String sql = "SELECT COUNT(*) FROM driver_profiles p WHERE p.is_online";
    if (regionId != null) {
      sql += " AND " + ACTIVE_VEHICLE_IN_REGION;
    }
    return namedJdbcTemplate.queryForObject(sql, params(null, null, regionId), Long.class);
  }

  /**
   * The mean actual pickup time (accept → arrive) of the range's rides that reached arrival.
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region
   * @return seconds, or null when no ride reached arrival
   */
  public BigDecimal avgPickupSeconds(Instant from, Instant to, UUID regionId) {
    return namedJdbcTemplate.queryForObject(
        "SELECT AVG(EXTRACT(EPOCH FROM (r.driver_arrived_at - r.accepted_at))) FROM rides r"
            + RIDES_IN_RANGE
            + " AND r.driver_arrived_at IS NOT NULL AND r.accepted_at IS NOT NULL"
            + regionClause(regionId),
        params(from, to, regionId),
        BigDecimal.class);
  }

  /**
   * Offers made in the range and answered: accepted, and accepted + declined + timeout (withdrawn
   * and still-open offers left out — the driver-performance formula).
   *
   * @param from inclusive
   * @param to exclusive
   * @param regionId optional region (the offered ride's)
   * @return the counts
   */
  public OfferCounts offerCounts(Instant from, Instant to, UUID regionId) {
    String sql =
        """
        SELECT COUNT(*) FILTER (WHERE o.response = 'accepted') AS accepted,
               COUNT(*) FILTER (WHERE o.response IN ('accepted', 'declined', 'timeout'))
                   AS answered
        FROM ride_offers o
        """;
    if (regionId != null) {
      sql += " JOIN rides r ON r.ride_id = o.ride_id AND r.region_id = :regionId";
    }
    sql += " WHERE o.offered_at >= :from AND o.offered_at < :to";
    return namedJdbcTemplate.queryForObject(
        sql,
        params(from, to, regionId),
        (rs, i) -> new OfferCounts(rs.getLong("accepted"), rs.getLong("answered")));
  }

  /**
   * Surge zones whose current multiplier is above 1.00 (point in time, ruling Q3).
   *
   * @param regionId optional region
   * @return the count
   */
  public long activeSurgeZones(UUID regionId) {
    String sql = "SELECT COUNT(*) FROM surge_zones z WHERE z.current_multiplier > 1";
    if (regionId != null) {
      sql += " AND z.region_id = :regionId";
    }
    return namedJdbcTemplate.queryForObject(sql, params(null, null, regionId), Long.class);
  }

  private static String regionClause(UUID regionId) {
    return regionId == null ? "" : " AND r.region_id = :regionId";
  }

  private static MapSqlParameterSource params(Instant from, Instant to, UUID regionId) {
    return new MapSqlParameterSource()
        .addValue("from", from == null ? null : OffsetDateTime.ofInstant(from, ZoneOffset.UTC))
        .addValue("to", to == null ? null : OffsetDateTime.ofInstant(to, ZoneOffset.UTC))
        .addValue("regionId", regionId);
  }
}
