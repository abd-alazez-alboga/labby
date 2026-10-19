package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketSide;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.repository.SupportTicketRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sends one waiting_on_user reminder in its OWN transaction: the conditional stamp decides, so a
 * reply or status change that landed meanwhile (or a concurrent pass) sends nothing.
 */
@Service
@RequiredArgsConstructor
public class TicketReminderWriter {

  private final SupportTicketRepository supportTicketRepository;
  private final TicketHistory history;
  private final NotificationService notificationService;

  /**
   * Stamps and queues the reminder unless the ticket left {@code waiting_on_user} or was reminded.
   *
   * @param ticketId the ticket
   * @param now the moment
   * @return true when a reminder was queued
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public boolean remindIfDue(UUID ticketId, Instant now) {
    if (supportTicketRepository.stampReminderIfDue(ticketId, now) == 0) {
      return false;
    }
    SupportTicket ticket = supportTicketRepository.findById(ticketId).orElseThrow();
    history.record(ticket, TicketEventType.REMINDER_SENT, TicketSide.SYSTEM, null, null, null, now);
    notificationService.queue(
        ticket.getUserId(),
        NotificationEvent.SUPPORT_WAITING_REMINDER,
        Map.of("ticketId", ticketId.toString()));
    return true;
  }
}
