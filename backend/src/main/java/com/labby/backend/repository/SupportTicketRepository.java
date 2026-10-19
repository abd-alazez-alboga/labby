package com.labby.backend.repository;

import com.labby.backend.model.SupportTicket;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Support tickets and lost-item cases (SUP-01..03, LOST-01/02; V26/V27). */
public interface SupportTicketRepository
    extends JpaRepository<SupportTicket, UUID>, JpaSpecificationExecutor<SupportTicket> {

  Optional<SupportTicket> findByIdAndUserId(UUID id, UUID userId);

  Optional<SupportTicket> findBySosEventId(UUID sosEventId);

  List<SupportTicket> findBySosEventIdIn(Collection<UUID> sosEventIds);

  boolean existsByTicketCategoryId(UUID ticketCategoryId);

  long countByTicketCategoryId(UUID ticketCategoryId);

  /**
   * LOST-01 / the chat hook: whether a non-closed lost-item case exists for a ride and its rider —
   * the row {@code uq_support_tickets_open_case} guards.
   */
  @Query(
      """
      SELECT COUNT(t) > 0 FROM SupportTicket t
      WHERE t.rideId = :rideId AND t.userId = :riderUserId
        AND t.kind = com.labby.backend.enums.TicketKind.LOST_ITEM
        AND t.status <> com.labby.backend.enums.TicketStatus.CLOSED
      """)
  boolean existsOpenCase(@Param("rideId") UUID rideId, @Param("riderUserId") UUID riderUserId);

  /**
   * The non-closed lost-item cases on the given rides — {@link #existsOpenCase} for a whole page of
   * cases at once (review-M14 I4).
   */
  @Query(
      """
      SELECT t FROM SupportTicket t
      WHERE t.rideId IN :rideIds
        AND t.kind = com.labby.backend.enums.TicketKind.LOST_ITEM
        AND t.status <> com.labby.backend.enums.TicketStatus.CLOSED
      """)
  List<SupportTicket> findOpenCasesOnRides(@Param("rideIds") Collection<UUID> rideIds);

  /**
   * The lost-item cases a user is a party to — as the reporting rider or as the driver of the ride
   * (UC-D-21) — most recently updated first; {@code openOnly} keeps the non-closed ones.
   */
  @Query(
      value =
          """
          SELECT t FROM SupportTicket t, Ride r
          WHERE t.rideId = r.id AND t.kind = com.labby.backend.enums.TicketKind.LOST_ITEM
            AND (t.userId = :userId OR r.driverUserId = :userId)
            AND (:openOnly = false OR t.status <> com.labby.backend.enums.TicketStatus.CLOSED)
          ORDER BY t.updatedAt DESC, t.id
          """,
      countQuery =
          """
          SELECT COUNT(t) FROM SupportTicket t, Ride r
          WHERE t.rideId = r.id AND t.kind = com.labby.backend.enums.TicketKind.LOST_ITEM
            AND (t.userId = :userId OR r.driverUserId = :userId)
            AND (:openOnly = false OR t.status <> com.labby.backend.enums.TicketStatus.CLOSED)
          """)
  Page<SupportTicket> findCasesOf(
      @Param("userId") UUID userId, @Param("openOnly") boolean openOnly, Pageable pageable);

  /** One case the user is a party to (reporter or driver). */
  @Query(
      """
      SELECT t FROM SupportTicket t, Ride r
      WHERE t.id = :ticketId AND t.rideId = r.id
        AND t.kind = com.labby.backend.enums.TicketKind.LOST_ITEM
        AND (t.userId = :userId OR r.driverUserId = :userId)
      """)
  Optional<SupportTicket> findCaseOf(
      @Param("ticketId") UUID ticketId, @Param("userId") UUID userId);

  /**
   * The waiting_on_user tickets whose 48 h reminder is due (owner ruling 2026-10-19), oldest first;
   * {@code idx_support_tickets_waiting} serves it.
   */
  @Query(
      """
      SELECT t FROM SupportTicket t
      WHERE t.status = com.labby.backend.enums.TicketStatus.WAITING_ON_USER
        AND t.reminderSentAt IS NULL AND t.waitingSince <= :cutoff
      ORDER BY t.waitingSince
      """)
  List<SupportTicket> findReminderDue(@Param("cutoff") Instant cutoff, Pageable pageable);

  /**
   * Stamps the reminder — conditional, so of two concurrent job passes only one sends it, and only
   * while the current waiting stay began by the cutoff (re-checked here: the ticket may have left
   * and re-entered waiting_on_user since the scan). Bumps the V29 version like any write.
   *
   * @return 1 when stamped now, 0 when the ticket left waiting_on_user or was reminded meanwhile
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      value =
          """
          UPDATE support_tickets
          SET reminder_sent_at = :now, updated_at = :now, version = version + 1
          WHERE support_ticket_id = :ticketId AND status = 'waiting_on_user'
            AND reminder_sent_at IS NULL AND waiting_since <= :cutoff
          """,
      nativeQuery = true)
  int stampReminderIfDue(
      @Param("ticketId") UUID ticketId, @Param("now") Instant now, @Param("cutoff") Instant cutoff);

  /**
   * Stamps the user's read marker (V27) — one column, no version bump: the read marker never
   * competes with the workflow columns, so a thread view cannot write a stale status back.
   *
   * @param ticketId the ticket
   * @param now the moment
   * @return rows updated
   */
  @Modifying(flushAutomatically = true)
  @Query(
      value = "UPDATE support_tickets SET user_read_at = :now WHERE support_ticket_id = :ticketId",
      nativeQuery = true)
  int stampUserRead(@Param("ticketId") UUID ticketId, @Param("now") Instant now);
}
