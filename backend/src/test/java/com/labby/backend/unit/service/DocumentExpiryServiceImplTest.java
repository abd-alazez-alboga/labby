package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.OnboardingProperties;
import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReviewStatus;
import com.labby.backend.model.DriverDocument;
import com.labby.backend.repository.DriverDocumentRepository;
import com.labby.backend.service.DocumentExpiryServiceImpl;
import com.labby.backend.service.DocumentReminderWriter;
import com.labby.backend.service.DriverRoleService;
import com.labby.backend.service.NotificationService;
import com.labby.backend.service.OperatingCalendar;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * DRV-04 expiry pass on a FIXED clock: "today" is the Damascus date (UTC+3), documents are valid
 * through their expiry date, reminders 30/7 go out once, expired documents suspend.
 */
@ExtendWith(MockitoExtension.class)
class DocumentExpiryServiceImplTest {

  /** 2026-10-06 22:30 UTC is already 2026-10-07 in Damascus. */
  private static final Instant NOW = Instant.parse("2026-10-06T22:30:00Z");

  private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);
  private static final UUID DRIVER = UUID.randomUUID();

  @Mock private DriverDocumentRepository driverDocumentRepository;
  @Mock private DriverRoleService driverRoleService;
  @Mock private NotificationService notificationService;

  private DocumentExpiryServiceImpl service;

  @BeforeEach
  void setUp() {
    OperatingCalendar calendar =
        new OperatingCalendar(
            Clock.fixed(NOW, ZoneOffset.UTC), new OnboardingProperties("Asia/Damascus", "-"));
    service =
        new DocumentExpiryServiceImpl(
            driverDocumentRepository,
            driverRoleService,
            new DocumentReminderWriter(driverDocumentRepository, notificationService, calendar),
            calendar);
  }

  private static DriverDocument document(LocalDate expiresOn) {
    return DriverDocument.builder()
        .id(UUID.randomUUID())
        .driverUserId(DRIVER)
        .type(DocumentType.INSURANCE)
        .expiresOn(expiresOn)
        .reviewStatus(ReviewStatus.APPROVED)
        .build();
  }

  private void current(DriverDocument... documents) {
    when(driverDocumentRepository.findCurrentExpiringOnOrBefore(
            ReviewStatus.APPROVED, ApplicationStatus.APPROVED, TODAY.plusDays(30)))
        .thenReturn(List.of(documents));
  }

  @Test
  @DisplayName("30 days left → 30-day reminder; 7 left → 7-day reminder; both stamped once")
  void shouldSendEachReminderOnce() {
    DriverDocument in30 = document(TODAY.plusDays(30));
    DriverDocument in7 = document(TODAY.plusDays(7));
    DriverDocument alreadyReminded = document(TODAY.plusDays(5));
    alreadyReminded.setReminder7SentAt(NOW.minusSeconds(86_400));
    current(in30, in7, alreadyReminded);
    when(driverDocumentRepository.findById(in30.getId())).thenReturn(Optional.of(in30));
    when(driverDocumentRepository.findById(in7.getId())).thenReturn(Optional.of(in7));

    service.runExpiryCheck();

    assertThat(in30.getReminder30SentAt()).isEqualTo(NOW);
    assertThat(in30.getReminder7SentAt()).isNull();
    assertThat(in7.getReminder7SentAt()).isEqualTo(NOW);
    assertThat(in7.getReminder30SentAt()).isNull();
    verify(notificationService)
        .queue(
            DRIVER,
            NotificationEvent.DOCUMENT_EXPIRY_REMINDER,
            Map.of(
                "documentType",
                "insurance",
                "expiresOn",
                TODAY.plusDays(30).toString(),
                "daysLeft",
                30));
    verify(notificationService)
        .queue(
            DRIVER,
            NotificationEvent.DOCUMENT_EXPIRY_REMINDER,
            Map.of(
                "documentType",
                "insurance",
                "expiresOn",
                TODAY.plusDays(7).toString(),
                "daysLeft",
                7));
    verify(driverRoleService, never()).suspendForExpiredDocument(any());
  }

  @Test
  @DisplayName("valid through the expiry date (Damascus); expired the day after → suspend")
  void shouldSuspendOnlyAfterTheExpiryDate() {
    DriverDocument expiresToday = document(TODAY);
    expiresToday.setReminder7SentAt(NOW);
    current(expiresToday);
    service.runExpiryCheck();
    verify(driverRoleService, never()).suspendForExpiredDocument(any());

    DriverDocument expiredYesterday = document(TODAY.minusDays(1));
    current(expiredYesterday);
    service.runExpiryCheck();
    verify(driverRoleService).suspendForExpiredDocument(DRIVER);
    verify(notificationService, never())
        .queue(eq(DRIVER), eq(NotificationEvent.DOCUMENT_EXPIRY_REMINDER), anyMap());
  }
}
