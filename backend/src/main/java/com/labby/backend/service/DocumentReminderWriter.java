package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.repository.DriverDocumentRepository;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sends one expiry reminder (DRV-04) in its OWN transaction, so a concurrent admin decision on one
 * document (optimistic-lock conflict) skips only that reminder — retried on the next run — instead
 * of rolling back the whole daily pass.
 */
@Service
@RequiredArgsConstructor
public class DocumentReminderWriter {

  private final DriverDocumentRepository driverDocumentRepository;
  private final NotificationService notificationService;
  private final OperatingCalendar calendar;

  /**
   * Queues the reminder for the given tier unless already sent or the document is no longer
   * current, and stamps it.
   *
   * @param documentId the approved current document
   * @param daysLeftTier the reminder tier (30 or 7) — picks the stamp; the notice states the real
   *     days left
   * @return true when a reminder was queued
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public boolean remindIfDue(UUID documentId, int daysLeftTier) {
    DriverDocument document = driverDocumentRepository.findById(documentId).orElse(null);
    if (document == null || document.getReviewStatus() != ReviewStatus.APPROVED) {
      return false;
    }
    boolean secondTier = daysLeftTier == DocumentExpiryServiceImpl.SECOND_REMINDER_DAYS;
    if ((secondTier ? document.getReminder7SentAt() : document.getReminder30SentAt()) != null) {
      return false;
    }
    notificationService.queue(
        document.getDriverUserId(),
        NotificationEvent.DOCUMENT_EXPIRY_REMINDER,
        Map.of(
            "documentType",
            document.getType().getValue(),
            "expiresOn",
            document.getExpiresOn().toString(),
            // V1 audit W31: the REAL days left — the tier only picks which reminder is stamped
            // (a document first caught inside the window says 20 or 3, not 30 or 7).
            "daysLeft",
            (int) Math.max(0, ChronoUnit.DAYS.between(calendar.today(), document.getExpiresOn()))));
    if (secondTier) {
      document.setReminder7SentAt(calendar.now());
    } else {
      document.setReminder30SentAt(calendar.now());
    }
    driverDocumentRepository.save(document);
    return true;
  }
}
