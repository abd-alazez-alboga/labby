package com.labby.backend.unit.service;

import static com.labby.backend.service.NotificationDeliveryWriter.CLAIM_TIMEOUT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.DevicePlatform;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.PushStatus;
import com.labby.backend.model.DeviceToken;
import com.labby.backend.model.Notification;
import com.labby.backend.model.NotificationOutboxEntry;
import com.labby.backend.model.NotificationPreference;
import com.labby.backend.repository.DeviceTokenRepository;
import com.labby.backend.repository.NotificationOutboxRepository;
import com.labby.backend.repository.NotificationPreferenceRepository;
import com.labby.backend.repository.NotificationRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.NotificationDeliveryWriter;
import com.labby.backend.service.NotificationDeliveryWriter.Delivery;
import com.labby.backend.service.NotificationRenderer;
import com.labby.backend.service.NotificationRenderer.Rendered;
import java.time.Clock;
import java.time.Instant;
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
 * NTF-02 push decision: a muted mutable category is not pushed, but ride and safety are ALWAYS
 * pushed — even if a stale "disabled" preference row existed — and an {@code all}-audience
 * notification reaches every client's devices.
 */
@ExtendWith(MockitoExtension.class)
class NotificationDeliveryWriterTest {

  private static final UUID USER = UUID.randomUUID();
  private static final UUID OUTBOX = UUID.randomUUID();
  private static final Instant NOW = Instant.parse("2026-10-06T10:00:00Z");

  @Mock private NotificationOutboxRepository notificationOutboxRepository;
  @Mock private NotificationRepository notificationRepository;
  @Mock private NotificationPreferenceRepository notificationPreferenceRepository;
  @Mock private DeviceTokenRepository deviceTokenRepository;
  @Mock private UserRepository userRepository;
  @Mock private NotificationRenderer notificationRenderer;

  private NotificationDeliveryWriter writer;
  private NotificationOutboxEntry entry;

  @BeforeEach
  void setUp() {
    writer =
        new NotificationDeliveryWriter(
            notificationOutboxRepository,
            notificationRepository,
            notificationPreferenceRepository,
            deviceTokenRepository,
            userRepository,
            notificationRenderer,
            new ObjectMapper(),
            Clock.fixed(NOW, ZoneOffset.UTC));
    entry =
        NotificationOutboxEntry.builder()
            .id(OUTBOX)
            .userId(USER)
            .event("test.event")
            .createdAt(Instant.parse("2026-10-06T09:00:00Z"))
            .build();
    when(notificationOutboxRepository.lockClaimable(OUTBOX, NOW.minus(CLAIM_TIMEOUT)))
        .thenReturn(Optional.of(entry));
    when(notificationRepository.findByNotificationOutboxId(OUTBOX)).thenReturn(Optional.empty());
    lenient()
        .when(notificationRepository.save(any(Notification.class)))
        .thenAnswer(
            invocation -> {
              Notification saved = invocation.getArgument(0);
              saved.setId(UUID.randomUUID());
              return saved;
            });
  }

  private void renders(NotificationCategory category, NotificationAudience audience) {
    when(notificationRenderer.render(eq("test.event"), any()))
        .thenReturn(
            Optional.of(
                new Rendered(
                    category, audience, "test.event", "T", "B", "ع", "ب", null, Map.of())));
  }

  private void disabledPreference(NotificationCategory category) {
    when(notificationPreferenceRepository.findById(NotificationPreference.key(USER, category)))
        .thenReturn(
            Optional.of(
                NotificationPreference.builder()
                    .userId(USER)
                    .category(category.getValue())
                    .enabled(false)
                    .build()));
  }

  private static DeviceToken token(String value, ClientType app) {
    return DeviceToken.builder()
        .userId(USER)
        .token(value)
        .platform(DevicePlatform.ANDROID)
        .app(app)
        .build();
  }

  @Test
  @DisplayName("a muted mutable category is recorded but not pushed")
  void shouldMuteMutableCategory() {
    renders(NotificationCategory.PROMOTIONS, NotificationAudience.RIDER);
    disabledPreference(NotificationCategory.PROMOTIONS);

    Delivery delivery = writer.prepare(OUTBOX).orElseThrow();

    assertThat(delivery.decided()).isEqualTo(PushStatus.MUTED);
    assertThat(entry.getClaimedAt()).as("claimed before any push").isEqualTo(NOW);
    assertThat(delivery.notificationId()).isNotNull();
  }

  @Test
  @DisplayName("ride and safety override a disabled preference (critical never muted)")
  void shouldNeverMuteCriticalCategories() {
    for (NotificationCategory critical :
        List.of(NotificationCategory.RIDE, NotificationCategory.SAFETY)) {
      org.mockito.Mockito.reset(notificationRenderer, deviceTokenRepository);
      renders(critical, NotificationAudience.RIDER);
      when(deviceTokenRepository.findPushable(eq(USER), anyCollection(), eq(NOW)))
          .thenReturn(List.of(token("rider-device", ClientType.RIDER)));

      Delivery delivery = writer.prepare(OUTBOX).orElseThrow();

      assertThat(delivery.decided()).as("%s", critical).isNull();
      assertThat(delivery.tokens()).containsExactly("rider-device");
      assertThat(delivery.message().data()).containsEntry("category", critical.getValue());
    }
  }

  @Test
  @DisplayName("an already-recorded center row with a final push status is not pushed again")
  void shouldNotRepushAFinishedRow() {
    renders(NotificationCategory.ACCOUNT, NotificationAudience.DRIVER);
    Notification existing =
        Notification.builder()
            .id(UUID.randomUUID())
            .userId(USER)
            .category(NotificationCategory.ACCOUNT)
            .audience(NotificationAudience.DRIVER)
            .pushStatus(PushStatus.SENT)
            .build();
    when(notificationRepository.findByNotificationOutboxId(OUTBOX))
        .thenReturn(Optional.of(existing));

    Delivery delivery = writer.prepare(OUTBOX).orElseThrow();

    assertThat(delivery.notificationId()).isEqualTo(existing.getId());
    assertThat(delivery.decided()).isEqualTo(PushStatus.SENT);
  }
}
