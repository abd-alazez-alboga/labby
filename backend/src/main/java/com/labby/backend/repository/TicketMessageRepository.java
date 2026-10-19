package com.labby.backend.repository;

import com.labby.backend.enums.TicketSide;
import com.labby.backend.model.TicketMessage;
import com.labby.backend.repository.projection.TicketCountRow;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The user <-> support threads (SUP-02, V26). */
public interface TicketMessageRepository extends JpaRepository<TicketMessage, UUID> {

  List<TicketMessage> findByTicketIdOrderByCreatedAtAscIdAsc(UUID ticketId);

  Optional<TicketMessage> findFirstByTicketIdOrderByCreatedAtDescIdDesc(UUID ticketId);

  /** Support messages the user has not read yet (after the V27 read marker; all when null). */
  @Query(
      value =
          """
          SELECT m.support_ticket_id AS ticketId, COUNT(*) AS count
          FROM ticket_messages m JOIN support_tickets t ON t.support_ticket_id = m.support_ticket_id
          WHERE m.support_ticket_id IN (:ticketIds) AND m.sender_side = 'support'
            AND (t.user_read_at IS NULL OR m.created_at > t.user_read_at)
          GROUP BY m.support_ticket_id
          """,
      nativeQuery = true)
  List<TicketCountRow> countUnreadSupportMessages(@Param("ticketIds") Collection<UUID> ticketIds);

  /** The moment of each ticket's latest message. */
  @Query(
      """
      SELECT m.ticketId AS ticketId, MAX(m.createdAt) AS lastAt FROM TicketMessage m
      WHERE m.ticketId IN :ticketIds GROUP BY m.ticketId
      """)
  List<LastMessageRow> findLastMessageAt(@Param("ticketIds") Collection<UUID> ticketIds);

  long countByTicketIdAndSenderSideAndCreatedAtAfter(
      UUID ticketId, TicketSide senderSide, Instant after);

  /** One (ticket, latest message moment) row. */
  interface LastMessageRow {

    UUID getTicketId();

    Instant getLastAt();
  }
}
