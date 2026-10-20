package com.labby.backend.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
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
 * Read-only joins of the admin ride screens (review V1 W15, UC-A-18): what else is filed about one
 * ride — its reports, support tickets, lost-item cases and SOS events — and the shared-ride seat /
 * party counts of the rides list. Newest first everywhere.
 */
@Repository
@RequiredArgsConstructor
public class AdminRideRelatedRepository {

  private final NamedParameterJdbcTemplate namedJdbcTemplate;

  /** A report filed on the ride. */
  public record ReportRow(
      UUID reportId,
      String category,
      String status,
      UUID reporterUserId,
      String reporterName,
      String reporterRole,
      UUID reportedUserId,
      String reportedName,
      String reportedRole,
      Instant createdAt) {}

  /** A support ticket or lost-item case about the ride ({@code kind} ticket / lost_item). */
  public record TicketRow(
      UUID ticketId,
      String kind,
      UUID categoryId,
      String categoryNameEn,
      String categoryNameAr,
      String description,
      String status,
      String caseStatus,
      String priority,
      UUID userId,
      String userName,
      String submittedAs,
      UUID sosEventId,
      Instant createdAt) {}

  /** An SOS event on the ride, with the support ticket linked to it (if any). */
  public record SosRow(
      UUID sosEventId,
      UUID triggeredByUserId,
      String triggeredByName,
      String triggeredByRole,
      Instant triggeredAt,
      Instant acknowledgedAt,
      UUID ticketId) {}

  /** A shared ride's occupancy for the rides list. */
  public record SharedCountRow(UUID rideId, int seats, int parties) {}

  /**
   * Whether the ride exists.
   *
   * @param rideId the ride
   * @return true when it does
   */
  public boolean rideExists(UUID rideId) {
    return Boolean.TRUE.equals(
        namedJdbcTemplate.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM rides WHERE ride_id = :rideId)",
            new MapSqlParameterSource("rideId", rideId),
            Boolean.class));
  }

  /**
   * The reports filed on a ride.
   *
   * @param rideId the ride
   * @return the rows, newest first
   */
  public List<ReportRow> reports(UUID rideId) {
    return namedJdbcTemplate.query(
        """
        SELECT r.report_id, r.category, r.status, r.reporter_user_id, reporter.name AS reporter_name,
               r.reporter_role, r.reported_user_id, reported.name AS reported_name,
               r.reported_role, r.created_at
        FROM reports r
                 JOIN users reporter ON reporter.user_id = r.reporter_user_id
                 JOIN users reported ON reported.user_id = r.reported_user_id
        WHERE r.ride_id = :rideId
        ORDER BY r.created_at DESC, r.report_id
        """,
        new MapSqlParameterSource("rideId", rideId),
        (rs, i) ->
            new ReportRow(
                uuid(rs, "report_id"),
                rs.getString("category"),
                rs.getString("status"),
                uuid(rs, "reporter_user_id"),
                rs.getString("reporter_name"),
                rs.getString("reporter_role"),
                uuid(rs, "reported_user_id"),
                rs.getString("reported_name"),
                rs.getString("reported_role"),
                instant(rs, "created_at")));
  }

  /**
   * The support tickets and lost-item cases about a ride.
   *
   * @param rideId the ride
   * @return the rows, newest first
   */
  public List<TicketRow> tickets(UUID rideId) {
    return namedJdbcTemplate.query(
        """
        SELECT t.support_ticket_id, t.kind, t.ticket_category_id, c.name_en, c.name_ar,
               t.description, t.status, t.case_status, t.priority, t.user_id, u.name AS user_name,
               t.submitted_as, t.sos_event_id, t.created_at
        FROM support_tickets t
                 JOIN ticket_categories c ON c.ticket_category_id = t.ticket_category_id
                 JOIN users u ON u.user_id = t.user_id
        WHERE t.ride_id = :rideId
        ORDER BY t.created_at DESC, t.support_ticket_id
        """,
        new MapSqlParameterSource("rideId", rideId),
        (rs, i) ->
            new TicketRow(
                uuid(rs, "support_ticket_id"),
                rs.getString("kind"),
                uuid(rs, "ticket_category_id"),
                rs.getString("name_en"),
                rs.getString("name_ar"),
                rs.getString("description"),
                rs.getString("status"),
                rs.getString("case_status"),
                rs.getString("priority"),
                uuid(rs, "user_id"),
                rs.getString("user_name"),
                rs.getString("submitted_as"),
                uuid(rs, "sos_event_id"),
                instant(rs, "created_at")));
  }

  /**
   * The SOS events of a ride.
   *
   * @param rideId the ride
   * @return the rows, newest first
   */
  public List<SosRow> sosEvents(UUID rideId) {
    return namedJdbcTemplate.query(
        """
        SELECT s.sos_event_id, s.triggered_by_user_id, u.name AS user_name, s.triggered_by_role,
               s.triggered_at, s.acknowledged_at, t.support_ticket_id
        FROM sos_events s
                 JOIN users u ON u.user_id = s.triggered_by_user_id
                 LEFT JOIN support_tickets t ON t.sos_event_id = s.sos_event_id
        WHERE s.ride_id = :rideId
        ORDER BY s.triggered_at DESC, s.sos_event_id
        """,
        new MapSqlParameterSource("rideId", rideId),
        (rs, i) ->
            new SosRow(
                uuid(rs, "sos_event_id"),
                uuid(rs, "triggered_by_user_id"),
                rs.getString("user_name"),
                rs.getString("triggered_by_role"),
                instant(rs, "triggered_at"),
                instant(rs, "acknowledged_at"),
                uuid(rs, "support_ticket_id")));
  }

  /**
   * The occupancy of shared rides: the seats the fare was split over once completed, else the seats
   * held now; and the parties riding (joined or completed members, the creator included).
   *
   * @param rideIds the rides (non-shared ones simply have no row)
   * @return one row per shared ride
   */
  public List<SharedCountRow> sharedCounts(Collection<UUID> rideIds) {
    if (rideIds.isEmpty()) {
      return List.of();
    }
    return namedJdbcTemplate.query(
        """
        SELECT s.ride_id, COALESCE(s.split_seats, s.seats_taken) AS seats,
               (SELECT COUNT(*) FROM shared_ride_members m
                WHERE m.ride_id = s.ride_id AND m.status IN ('joined', 'completed')) AS parties
        FROM shared_rides s
        WHERE s.ride_id IN (:ids)
        """,
        new MapSqlParameterSource("ids", rideIds),
        (rs, i) ->
            new SharedCountRow(uuid(rs, "ride_id"), rs.getInt("seats"), rs.getInt("parties")));
  }

  private static UUID uuid(ResultSet rs, String column) throws SQLException {
    return rs.getObject(column, UUID.class);
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }
}
