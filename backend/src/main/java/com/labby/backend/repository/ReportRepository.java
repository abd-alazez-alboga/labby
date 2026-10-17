package com.labby.backend.repository;

import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.model.Report;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** REP-01..03 reports: permanent facts, resolved exactly once (V17 trigger). */
public interface ReportRepository extends JpaRepository<Report, UUID> {

  boolean existsByRideIdAndReporterUserIdAndReportedUserId(
      UUID rideId, UUID reporterUserId, UUID reportedUserId);

  /** The reporter's own reports on one side, newest first. */
  Page<Report> findByReporterUserIdAndReporterRoleOrderByCreatedAtDesc(
      UUID reporterUserId, RideParty reporterRole, Pageable pageable);

  /** The admin queue (UC-A-17), oldest first. */
  Page<Report> findByStatusOrderByCreatedAtAsc(ReportStatus status, Pageable pageable);

  /** The admin queue for one reported user, oldest first. */
  Page<Report> findByStatusAndReportedUserIdOrderByCreatedAtAsc(
      ReportStatus status, UUID reportedUserId, Pageable pageable);

  long countByReportedUserIdAndReportedRole(UUID reportedUserId, RideParty reportedRole);

  long countByReportedUserIdAndReportedRoleAndStatus(
      UUID reportedUserId, RideParty reportedRole, ReportStatus status);

  long countByReporterUserIdAndReporterRole(UUID reporterUserId, RideParty reporterRole);

  /**
   * REP-03 sliding window: the substantiated reports against one user x role resolved at or after
   * {@code since}, oldest resolution first.
   *
   * @param reportedUserId the reported user
   * @param reportedRole the reported role
   * @param since the window start
   * @return the reports
   */
  @Query(
      """
      SELECT r FROM Report r
      WHERE r.reportedUserId = :reportedUserId AND r.reportedRole = :reportedRole
        AND r.status = com.labby.backend.enums.ReportStatus.SUBSTANTIATED
        AND r.resolvedAt >= :since
      ORDER BY r.resolvedAt ASC
      """)
  List<Report> findSubstantiatedSince(
      @Param("reportedUserId") UUID reportedUserId,
      @Param("reportedRole") RideParty reportedRole,
      @Param("since") Instant since);

  /**
   * Resolves an OPEN report — conditional, so of two concurrent resolutions only one updates.
   *
   * @return 1 when resolved now, 0 when already resolved
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE reports SET status = :status, resolution_note = :note, resolved_by = :resolvedBy,
                 resolved_at = :resolvedAt
          WHERE report_id = :reportId AND status = 'open'
          """,
      nativeQuery = true)
  int resolveIfOpen(
      @Param("reportId") UUID reportId,
      @Param("status") String status,
      @Param("note") String note,
      @Param("resolvedBy") UUID resolvedBy,
      @Param("resolvedAt") Instant resolvedAt);
}
