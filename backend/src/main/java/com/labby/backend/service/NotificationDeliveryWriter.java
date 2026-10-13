package com.labby.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.PushStatus;
import com.labby.backend.model.DeviceToken;
import com.labby.backend.model.Notification;
import com.labby.backend.model.NotificationOutboxEntry;
import com.labby.backend.model.NotificationPreference;
import com.labby.backend.model.User;
import com.labby.backend.repository.DeviceTokenRepository;
import com.labby.backend.repository.NotificationOutboxRepository;
import com.labby.backend.repository.NotificationPreferenceRepository;
import com.labby.backend.repository.NotificationRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.PushSender.PushMessage;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional halves of delivering one outbox entry (NTF-01..03). {@link #prepare} claims the
 * entry and commits the notification-center row in its OWN transaction before any push is
 * attempted; {@link #complete} records the push outcome and marks the entry delivered in another.
 * The push itself runs between them, outside any transaction, so a push failure can never roll back
 * the center row (NFR-A3). The claim keeps every other dispatcher instance off the entry while the
 * push is in flight (NFR-P4); a claim older than {@link #CLAIM_TIMEOUT} is stale (its instance died
 * mid-push) and the entry is retried.
 */
@Service
@RequiredArgsConstructor
public class NotificationDeliveryWriter {

  /**
   * How long a dispatcher's claim on an entry holds before another dispatcher may take it over —
   * comfortably longer than a push normally takes. Delivery is at-least-once: only a push still in
   * flight past this timeout (or an instance that died mid-push) can be sent again.
   */
  public static final Duration CLAIM_TIMEOUT = Duration.ofMinutes(2);

  private final NotificationOutboxRepository notificationOutboxRepository;
  private final NotificationRepository notificationRepository;
  private final NotificationPreferenceRepository notificationPreferenceRepository;
  private final DeviceTokenRepository deviceTokenRepository;
  private final UserRepository userRepository;
  private final NotificationRenderer notificationRenderer;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  /**
   * What is left to do for one entry after its center row exists.
   *
   * @param outboxId the outbox entry
   * @param notificationId its center row
   * @param decided the push outcome already known without pushing (muted, no device, or the outcome
   *     of an earlier attempt), or null when a push must be sent
   * @param tokens the device tokens to push to (empty unless a push is needed)
   * @param message the localized push (null unless a push is needed)
   */
  public record Delivery(
      UUID outboxId,
      UUID notificationId,
      PushStatus decided,
      List<String> tokens,
      PushMessage message) {}

  /**
   * The next batch of undelivered, renderable entries no other dispatcher holds, oldest first.
   *
   * @param limit the batch size
   * @return the entry ids
   */
  @Transactional(readOnly = true)
  public List<UUID> pendingOutboxIds(int limit) {
    return notificationOutboxRepository.findPendingIds(
        notificationRenderer.supportedEvents(), clock.instant().minus(CLAIM_TIMEOUT), limit);
  }

  /**
   * Claims the entry, renders it into its center row (once — idempotent per outbox row) and decides
   * whether a push is due: muted category (never for ride/safety — NTF-02), no pushable device of
   * the audience (a device counts only while the account holds a live session), or a push in the
   * user's current language. The claim commits with the center row, before the push.
   *
   * @param outboxId the entry
   * @return the remaining work, or empty when already delivered, claimed or locked by another
   *     dispatcher, or not renderable
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public Optional<Delivery> prepare(UUID outboxId) {
    Instant now = clock.instant();
    Optional<NotificationOutboxEntry> locked =
        notificationOutboxRepository.lockClaimable(outboxId, now.minus(CLAIM_TIMEOUT));
    if (locked.isEmpty()) {
      return Optional.empty();
    }
    NotificationOutboxEntry entry = locked.get();
    entry.setClaimedAt(now);
    Optional<NotificationRenderer.Rendered> rendered =
        notificationRenderer.render(entry.getEvent(), entry.getParams());
    if (rendered.isEmpty()) {
      return Optional.empty();
    }
    Notification notification =
        notificationRepository
            .findByNotificationOutboxId(outboxId)
            .orElseGet(() -> notificationRepository.save(centerRow(entry, rendered.get())));
    if (notification.getPushStatus() != PushStatus.PENDING) {
      return Optional.of(
          new Delivery(
              outboxId, notification.getId(), notification.getPushStatus(), List.of(), null));
    }
    if (isMuted(notification) && !isRideCriticalChat(notification, entry)) {
      return Optional.of(
          new Delivery(outboxId, notification.getId(), PushStatus.MUTED, List.of(), null));
    }
    List<String> tokens =
        deviceTokenRepository
            .findPushable(notification.getUserId(), apps(notification.getAudience()), now)
            .stream()
            .map(DeviceToken::getToken)
            .toList();
    if (tokens.isEmpty()) {
      return Optional.of(
          new Delivery(outboxId, notification.getId(), PushStatus.NO_DEVICE, List.of(), null));
    }
    Language language =
        userRepository
            .findById(notification.getUserId())
            .map(User::getLanguage)
            .orElse(Language.EN);
    return Optional.of(
        new Delivery(
            outboxId, notification.getId(), null, tokens, pushMessage(notification, language)));
  }

  /**
   * Records the push outcome, prunes dead tokens and marks the outbox entry delivered.
   *
   * @param delivery the prepared delivery
   * @param status the final push status
   * @param deadTokens tokens the push service reported unregistered/invalid
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void complete(Delivery delivery, PushStatus status, Set<String> deadTokens) {
    notificationRepository
        .findById(delivery.notificationId())
        .ifPresent(
            notification -> {
              notification.setPushStatus(status);
              if (status == PushStatus.SENT) {
                notification.setPushedAt(clock.instant());
              }
            });
    if (!deadTokens.isEmpty()) {
      deviceTokenRepository.deleteByTokens(deadTokens);
    }
    notificationOutboxRepository
        .findById(delivery.outboxId())
        .ifPresent(entry -> entry.setDeliveredAt(clock.instant()));
  }

  /**
   * CHAT-02's ride-critical ruling (M10): a chat push for a message sent while the ride was ACTIVE
   * is delivered even when the recipient muted the {@code chat} category; after the ride ends (the
   * 24 h tail and reopened windows) the mute applies normally.
   */
  private static boolean isRideCriticalChat(
      Notification notification, NotificationOutboxEntry entry) {
    return notification.getCategory() == NotificationCategory.CHAT
        && entry.getParams() != null
        && "true".equals(String.valueOf(entry.getParams().get("rideActive")));
  }

  private boolean isMuted(Notification notification) {
    if (!notification.getCategory().isMutable()) {
      return false;
    }
    return notificationPreferenceRepository
        .findById(NotificationPreference.key(notification.getUserId(), notification.getCategory()))
        .map(preference -> !preference.isEnabled())
        .orElse(false);
  }

  private static Set<ClientType> apps(NotificationAudience audience) {
    return switch (audience) {
      case RIDER -> EnumSet.of(ClientType.RIDER);
      case DRIVER -> EnumSet.of(ClientType.DRIVER);
      case ADMIN -> EnumSet.of(ClientType.ADMIN);
      case ALL -> EnumSet.allOf(ClientType.class);
    };
  }

  private static Notification centerRow(
      NotificationOutboxEntry entry, NotificationRenderer.Rendered rendered) {
    return Notification.builder()
        .userId(entry.getUserId())
        .audience(rendered.audience())
        .category(rendered.category())
        .event(rendered.event())
        .titleEn(rendered.titleEn())
        .bodyEn(rendered.bodyEn())
        .titleAr(rendered.titleAr())
        .bodyAr(rendered.bodyAr())
        .linkScreen(rendered.linkScreen())
        .linkParams(
            rendered.linkScreen() == null ? null : new LinkedHashMap<>(rendered.linkParams()))
        .notificationOutboxId(entry.getId())
        // The center orders by when the event happened, so backfilled entries keep their place.
        .createdAt(entry.getCreatedAt())
        .build();
  }

  /**
   * The push in the user's language. Data keys (realtime-v1.yaml "Push payload"): {@code
   * notificationId}, {@code category}, {@code event}, and when linked {@code screen} + {@code
   * params} (a JSON object string).
   */
  private PushMessage pushMessage(Notification notification, Language language) {
    Map<String, String> data = new LinkedHashMap<>();
    data.put("notificationId", notification.getId().toString());
    data.put("category", notification.getCategory().getValue());
    data.put("event", notification.getEvent());
    if (notification.getLinkScreen() != null) {
      data.put("screen", notification.getLinkScreen());
      Map<String, String> params =
          notification.getLinkParams() == null ? Map.of() : notification.getLinkParams();
      try {
        data.put("params", objectMapper.writeValueAsString(params));
      } catch (JsonProcessingException ex) {
        throw new IllegalStateException("Deep-link params are not serializable", ex);
      }
    }
    boolean arabic = language == Language.AR;
    return new PushMessage(
        arabic ? notification.getTitleAr() : notification.getTitleEn(),
        arabic ? notification.getBodyAr() : notification.getBodyEn(),
        data);
  }
}
