package com.labby.backend.repository;

import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The driver's trip rows (UC-D-15, V1 conformance W43): one row per COM-01 money anchor (fare
 * posting or collected cancellation fee, per shared-ride member), plus one row per ride the driver
 * had ACCEPTED that was later cancelled and moved no anchor money for them — per dispatched member
 * on a shared ride — so a past trip can be opened and its rider reported (REP-01). Newest first.
 */
@Repository
@RequiredArgsConstructor
public class DriverTripRepository {

  private static final String ANCHOR_TYPES =
      "('ride_earning', 'commission_due', 'cancellation_fee')";

  private static final String ROWS =
      "SELECT l.ride_id, l.shared_ride_member_id AS member_id, l.driver_ledger_id AS anchor_id,"
          + " l.created_at AS at FROM driver_ledger l"
          + " WHERE l.driver_user_id = :driverUserId AND l.type IN "
          + ANCHOR_TYPES
          + " UNION ALL"
          + " SELECT r.ride_id, m.shared_ride_member_id, NULL, r.cancelled_at FROM rides r"
          + " LEFT JOIN shared_ride_members m ON r.kind = 'shared' AND m.ride_id = r.ride_id"
          + " AND m.status IN ('joined', 'completed', 'cancelled', 'no_show')"
          + " WHERE r.driver_user_id = :driverUserId AND r.accepted_at IS NOT NULL"
          + " AND r.state IN ('cancelled_by_rider', 'cancelled_by_driver')"
          + " AND NOT EXISTS (SELECT 1 FROM driver_ledger x WHERE x.driver_user_id = :driverUserId"
          + " AND x.ride_id = r.ride_id AND x.type IN "
          + ANCHOR_TYPES
          + " AND x.shared_ride_member_id IS NOT DISTINCT FROM m.shared_ride_member_id)";

  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /**
   * One trip row: its ride, the shared-ride member (null on a one-rider ride), the money anchor
   * (null for a cancelled ride without one) and its moment (anchor creation or cancellation).
   */
  public record TripRow(UUID rideId, UUID memberId, UUID anchorId, Instant at) {}

  /** A report the driver filed on a ride, against one rider. */
  public record DriverReport(
      UUID rideId,
      UUID reportedUserId,
      UUID reportId,
      ReportCategory category,
      ReportStatus status,
      Instant createdAt) {}

  /**
   * One newest-first page of the driver's trip rows.
   *
   * @param driverUserId the driver
   * @param limit page size
   * @param offset rows to skip
   * @return the rows
   */
  public List<TripRow> page(UUID driverUserId, int limit, long offset) {
    return namedJdbcTemplate.query(
        "SELECT * FROM ("
            + ROWS
            + ") t ORDER BY t.at DESC, COALESCE(t.anchor_id, t.ride_id) DESC"
            + " LIMIT :limit OFFSET :offset",
        new MapSqlParameterSource()
            .addValue("driverUserId", driverUserId)
            .addValue("limit", limit)
            .addValue("offset", offset),
        (rs, i) -> row(rs));
  }

  /**
   * How many trip rows the driver has.
   *
   * @param driverUserId the driver
   * @return the count
   */
  public long count(UUID driverUserId) {
    Long count =
        namedJdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM (" + ROWS + ") t",
            new MapSqlParameterSource("driverUserId", driverUserId),
            Long.class);
    return count == null ? 0 : count;
  }

  /**
   * The driver's trip rows of one ride (one per member on a shared ride).
   *
   * @param driverUserId the driver
   * @param rideId the ride
   * @return the rows, newest first
   */
  public List<TripRow> ofRide(UUID driverUserId, UUID rideId) {
    return namedJdbcTemplate.query(
        "SELECT * FROM (" + ROWS + ") t WHERE t.ride_id = :rideId ORDER BY t.at DESC",
        new MapSqlParameterSource()
            .addValue("driverUserId", driverUserId)
            .addValue("rideId", rideId),
        (rs, i) -> row(rs));
  }

  /**
   * The reports the driver filed on the rides (REP-01: one per ride per reported rider).
   *
   * @param driverUserId the reporting driver
   * @param rideIds the rides
   * @return the reports
   */
  public List<DriverReport> reportsOn(UUID driverUserId, Collection<UUID> rideIds) {
    if (rideIds.isEmpty()) {
      return List.of();
    }
    return namedJdbcTemplate.query(
        "SELECT ride_id, reported_user_id, report_id, category, status, created_at FROM reports"
            + " WHERE reporter_user_id = :driverUserId AND reporter_role = 'driver'"
            + " AND ride_id IN (:rideIds)",
        new MapSqlParameterSource()
            .addValue("driverUserId", driverUserId)
            .addValue("rideIds", rideIds),
        (rs, i) ->
            new DriverReport(
                rs.getObject("ride_id", UUID.class),
                rs.getObject("reported_user_id", UUID.class),
                rs.getObject("report_id", UUID.class),
                ReportCategory.fromValue(rs.getString("category")),
                ReportStatus.fromValue(rs.getString("status")),
                rs.getObject("created_at", OffsetDateTime.class).toInstant()));
  }

  private static TripRow row(java.sql.ResultSet rs) throws java.sql.SQLException {
    return new TripRow(
        rs.getObject("ride_id", UUID.class),
        rs.getObject("member_id", UUID.class),
        rs.getObject("anchor_id", UUID.class),
        rs.getObject("at", OffsetDateTime.class).toInstant());
  }
}
