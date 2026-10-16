package com.labby.backend.repository;

import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.FlagStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.model.AccountFlag;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The flagged-accounts queue (ADM-04, UC-A-16). */
public interface AccountFlagRepository extends JpaRepository<AccountFlag, UUID> {

  /**
   * Opens a flag unless one of the same user x role x kind is already open (V17 partial unique
   * index) — a no-op then, never an error that would abort the caller's transaction.
   *
   * @return 1 when opened now, 0 when one was already open
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO account_flags (user_id, role, kind, details, status, raised_at)
          VALUES (:userId, :role, :kind, CAST(:details AS jsonb), 'open', :raisedAt)
          ON CONFLICT (user_id, role, kind) WHERE status = 'open' DO NOTHING
          """,
      nativeQuery = true)
  int openIfAbsent(
      @Param("userId") UUID userId,
      @Param("role") String role,
      @Param("kind") String kind,
      @Param("details") String details,
      @Param("raisedAt") Instant raisedAt);

  /**
   * One queue page, oldest first; null filters match everything.
   *
   * @param status the status
   * @param kind the kind, or null
   * @param userId the user (as text), or null
   * @param pageable the page
   * @return the page
   */
  @Query(
      value =
          """
          SELECT f.* FROM account_flags f
          WHERE f.status = :status
            AND (CAST(:kind AS varchar) IS NULL OR f.kind = CAST(:kind AS varchar))
            AND (CAST(:userId AS uuid) IS NULL OR f.user_id = CAST(:userId AS uuid))
          ORDER BY f.raised_at ASC, f.account_flag_id ASC
          """,
      countQuery =
          """
          SELECT COUNT(*) FROM account_flags f
          WHERE f.status = :status
            AND (CAST(:kind AS varchar) IS NULL OR f.kind = CAST(:kind AS varchar))
            AND (CAST(:userId AS uuid) IS NULL OR f.user_id = CAST(:userId AS uuid))
          """,
      nativeQuery = true)
  Page<AccountFlag> findQueue(
      @Param("status") String status,
      @Param("kind") String kind,
      @Param("userId") String userId,
      Pageable pageable);

  /**
   * When the user x role's latest CLOSED flag of a kind was closed — the RATE-03 reopen rule (owner
   * ruling 2026-10-16): a closed low_rating flag reopens only after a newer rating.
   *
   * @return the latest resolution moment, or empty when none was ever closed
   */
  @Query(
      "SELECT MAX(f.resolvedAt) FROM AccountFlag f WHERE f.userId = :userId AND f.role = :role"
          + " AND f.kind = :kind AND f.status <> com.labby.backend.enums.FlagStatus.OPEN")
  Optional<Instant> latestClosedAt(
      @Param("userId") UUID userId, @Param("role") RideParty role, @Param("kind") FlagKind kind);

  /** A user's flags in one state, oldest first (the trust profile shows the open ones). */
  List<AccountFlag> findByUserIdAndStatusOrderByRaisedAtAsc(UUID userId, FlagStatus status);

  /**
   * Closes an OPEN flag — conditional, so of two concurrent resolutions only one updates.
   *
   * @return 1 when closed now, 0 when already closed
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE account_flags SET status = :status, resolved_by = :resolvedBy,
                 resolved_at = :resolvedAt, resolution_note = :note
          WHERE account_flag_id = :flagId AND status = 'open'
          """,
      nativeQuery = true)
  int resolveIfOpen(
      @Param("flagId") UUID flagId,
      @Param("status") String status,
      @Param("resolvedBy") UUID resolvedBy,
      @Param("resolvedAt") Instant resolvedAt,
      @Param("note") String note);
}
