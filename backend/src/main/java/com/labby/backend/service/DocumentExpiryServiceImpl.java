package com.labby.backend.service;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.repository.DriverDocumentRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** One daily expiry pass (see {@link DocumentExpiryService}). */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class DocumentExpiryServiceImpl implements DocumentExpiryService {

  static final int FIRST_REMINDER_DAYS = 30;
  static final int SECOND_REMINDER_DAYS = 7;

  private final DriverDocumentRepository driverDocumentRepository;
  private final DriverRoleService driverRoleService;
  private final NotificationService notificationService;
  private final OperatingCalendar calendar;

  @Override
  public void runExpiryCheck() {
    LocalDate today = calendar.today();
    Instant now = calendar.now();
    int reminders = 0;
    Set<UUID> driversWithExpiredDocument = new LinkedHashSet<>();
    for (DriverDocument document :
        driverDocumentRepository.findCurrentExpiringOnOrBefore(
            ReviewStatus.APPROVED,
            ApplicationStatus.APPROVED,
            today.plusDays(FIRST_REMINDER_DAYS))) {
      long daysLeft = ChronoUnit.DAYS.between(today, document.getExpiresOn());
      if (daysLeft < 0) {
        driversWithExpiredDocument.add(document.getDriverUserId());
      } else if (daysLeft <= SECOND_REMINDER_DAYS) {
        if (document.getReminder7SentAt() == null) {
          remind(document, SECOND_REMINDER_DAYS);
          document.setReminder7SentAt(now);
          reminders++;
        }
      } else if (document.getReminder30SentAt() == null) {
        remind(document, FIRST_REMINDER_DAYS);
        document.setReminder30SentAt(now);
        reminders++;
      }
    }
    int suspended = 0;
    for (UUID driverUserId : driversWithExpiredDocument) {
      if (driverRoleService.suspendForExpiredDocument(driverUserId)) {
        suspended++;
      }
    }
    log.info(
        "Document expiry pass for {}: {} reminder(s) queued, {} driver(s) suspended",
        today,
        reminders,
        suspended);
  }

  private void remind(DriverDocument document, int daysLeft) {
    notificationService.queue(
        document.getDriverUserId(),
        NotificationEvent.DOCUMENT_EXPIRY_REMINDER,
        Map.of(
            "documentType", document.getType().getValue(),
            "expiresOn", document.getExpiresOn().toString(),
            "daysLeft", daysLeft));
  }
}
