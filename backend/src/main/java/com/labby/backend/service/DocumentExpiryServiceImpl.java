package com.labby.backend.service;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.repository.DriverDocumentRepository;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

/**
 * One daily expiry pass (see {@link DocumentExpiryService}). Deliberately NOT one transaction: each
 * reminder ({@link DocumentReminderWriter}) and each suspension ({@link
 * DriverRoleService#suspendForExpiredDocument}, which locks the role row and re-checks) commits on
 * its own, so a concurrent admin decision can neither roll back the whole pass nor leave a driver
 * suspended on a stale read. A skipped item is retried on the next run.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentExpiryServiceImpl implements DocumentExpiryService {

  static final int FIRST_REMINDER_DAYS = 30;
  static final int SECOND_REMINDER_DAYS = 7;

  private final DriverDocumentRepository driverDocumentRepository;
  private final DriverRoleService driverRoleService;
  private final DocumentReminderWriter documentReminderWriter;
  private final OperatingCalendar calendar;

  @Override
  public void runExpiryCheck() {
    LocalDate today = calendar.today();
    int reminders = 0;
    int skipped = 0;
    Set<UUID> driversWithExpiredDocument = new LinkedHashSet<>();
    for (DriverDocument document :
        driverDocumentRepository.findCurrentExpiringOnOrBefore(
            ReviewStatus.APPROVED,
            ApplicationStatus.APPROVED,
            today.plusDays(FIRST_REMINDER_DAYS))) {
      long daysLeft = ChronoUnit.DAYS.between(today, document.getExpiresOn());
      if (daysLeft < 0) {
        driversWithExpiredDocument.add(document.getDriverUserId());
        continue;
      }
      int tier = daysLeft <= SECOND_REMINDER_DAYS ? SECOND_REMINDER_DAYS : FIRST_REMINDER_DAYS;
      boolean alreadySent =
          tier == SECOND_REMINDER_DAYS
              ? document.getReminder7SentAt() != null
              : document.getReminder30SentAt() != null;
      if (alreadySent) {
        continue;
      }
      try {
        if (documentReminderWriter.remindIfDue(document.getId(), tier)) {
          reminders++;
        }
      } catch (DataAccessException ex) {
        skipped++;
        log.warn("Expiry reminder for document {} skipped, retried next run", document.getId(), ex);
      }
    }
    int suspended = 0;
    for (UUID driverUserId : driversWithExpiredDocument) {
      try {
        if (driverRoleService.suspendForExpiredDocument(driverUserId)) {
          suspended++;
        }
      } catch (DataAccessException ex) {
        skipped++;
        log.warn("Expiry suspension for driver {} skipped, retried next run", driverUserId, ex);
      }
    }
    log.info(
        "Document expiry pass for {}: {} reminder(s) queued, {} driver(s) suspended, {} skipped",
        today,
        reminders,
        suspended,
        skipped);
  }
}
