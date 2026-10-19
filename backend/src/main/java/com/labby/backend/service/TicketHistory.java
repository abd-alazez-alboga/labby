package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketSide;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.model.TicketEvent;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketEventRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The SUP-02 bookkeeping every ticket mutation shares: the history row and the user's status
 * notification (category {@code account}, screen {@code ticket}).
 */
@Component
@RequiredArgsConstructor
public class TicketHistory {

  private final TicketEventRepository ticketEventRepository;
  private final SupportTicketRepository supportTicketRepository;
  private final NotificationService notificationService;

  /**
   * Records one history row.
   *
   * @param ticket the ticket
   * @param type the entry type
   * @param side the actor's side ({@code system} with a null actor)
   * @param actorUserId the actor, or null for the system
   * @param from the previous value, or null
   * @param to the new value, or null
   * @param now the moment
   */
  public void record(
      SupportTicket ticket,
      TicketEventType type,
      TicketSide side,
      UUID actorUserId,
      String from,
      String to,
      Instant now) {
    ticketEventRepository.save(
        TicketEvent.builder()
            .ticketId(ticket.getId())
            .type(type)
            .actorSide(side)
            .actorUserId(side == TicketSide.SYSTEM ? null : actorUserId)
            .fromValue(from)
            .toValue(to)
            .createdAt(now)
            .build());
  }

  /**
   * Moves a ticket's status with its history row and the user's notification (SUP-02: every status
   * change notifies). No-op when the status is unchanged.
   *
   * @param ticket the ticket
   * @param target the new status
   * @param side the actor's side
   * @param actorUserId the actor
   * @param now the moment
   * @return true when the status changed
   */
  public boolean move(
      SupportTicket ticket, TicketStatus target, TicketSide side, UUID actorUserId, Instant now) {
    TicketStatus from = ticket.getStatus();
    if (from == target) {
      return false;
    }
    ticket.moveTo(target, now);
    supportTicketRepository.save(ticket);
    record(
        ticket,
        TicketEventType.STATUS_CHANGED,
        side,
        actorUserId,
        from.getValue(),
        target.getValue(),
        now);
    notificationService.queue(
        ticket.getUserId(),
        NotificationEvent.SUPPORT_TICKET_STATUS_CHANGED,
        Map.of("ticketId", ticket.getId().toString(), "status", target.getValue()));
    return true;
  }

  /**
   * Touches a ticket's {@code updatedAt} (the user list sorts on it) without a status change.
   *
   * @param ticket the ticket
   * @param now the moment
   */
  public void touch(SupportTicket ticket, Instant now) {
    ticket.setUpdatedAt(now);
    supportTicketRepository.save(ticket);
  }
}
