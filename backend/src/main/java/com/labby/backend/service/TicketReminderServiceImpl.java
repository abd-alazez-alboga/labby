package com.labby.backend.service;

import com.labby.backend.config.SupportProperties;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.repository.SupportTicketRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/** The reminder pass (see {@link TicketReminderService}); deliberately NOT one transaction. */
@Slf4j
@Service
@RequiredArgsConstructor
public class TicketReminderServiceImpl implements TicketReminderService {

  static final int BATCH_SIZE = 200;

  private final SupportTicketRepository supportTicketRepository;
  private final TicketReminderWriter ticketReminderWriter;
  private final SupportProperties supportProperties;
  private final Clock clock;

  @Override
  public int runReminderPass() {
    Instant now = clock.instant();
    Instant cutoff = now.minus(Duration.ofHours(supportProperties.waitingReminderHours()));
    int sent = 0;
    int skipped = 0;
    List<SupportTicket> due;
    do {
      due = supportTicketRepository.findReminderDue(cutoff, PageRequest.of(0, BATCH_SIZE));
      int sentInBatch = 0;
      for (SupportTicket ticket : due) {
        try {
          if (ticketReminderWriter.remindIfDue(ticket.getId(), now)) {
            sentInBatch++;
          }
        } catch (DataAccessException ex) {
          skipped++;
          log.warn("Waiting reminder for ticket {} skipped, retried next run", ticket.getId(), ex);
        }
      }
      sent += sentInBatch;
      if (sentInBatch == 0) {
        break; // nothing left in the batch is due any more; do not spin
      }
    } while (due.size() == BATCH_SIZE);
    if (sent > 0 || skipped > 0) {
      log.info("Waiting-on-user reminder pass: {} queued, {} skipped", sent, skipped);
    }
    return sent;
  }
}
