package com.labby.backend.service;

import com.labby.backend.dto.DeepLinkDto;
import com.labby.backend.dto.NotificationDto;
import com.labby.backend.dto.NotificationPageDto;
import com.labby.backend.dto.UnreadCountDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Notification;
import com.labby.backend.model.User;
import com.labby.backend.repository.NotificationRepository;
import com.labby.backend.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Notification center backed by {@code notifications}. Pages use a keyset cursor on (created_at,
 * id) so new arrivals never shift later pages; the cursor is opaque to clients.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class NotificationCenterServiceImpl implements NotificationCenterService {

  static final int MAX_PAGE_SIZE = 50;

  private final NotificationRepository notificationRepository;
  private final UserRepository userRepository;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public NotificationPageDto list(
      UUID userId, String app, String category, String before, int size) {
    List<NotificationAudience> audiences = audiences(app);
    NotificationCategory categoryFilter = category(category);
    int pageSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    Limit limit = Limit.of(pageSize + 1);
    List<Notification> rows;
    if (before == null || before.isBlank()) {
      rows = notificationRepository.findPage(userId, audiences, categoryFilter, limit);
    } else {
      Cursor cursor = Cursor.decode(before);
      rows =
          notificationRepository.findPageBefore(
              userId, audiences, categoryFilter, cursor.createdAt(), cursor.id(), limit);
    }
    boolean hasNext = rows.size() > pageSize;
    List<Notification> page = hasNext ? rows.subList(0, pageSize) : rows;
    Language language = language(userId);
    String nextCursor = hasNext ? Cursor.encode(page.get(page.size() - 1)) : null;
    return new NotificationPageDto(
        page.stream().map(row -> toDto(row, language)).toList(),
        notificationRepository.countByUserIdAndAudienceInAndReadAtIsNull(userId, audiences),
        nextCursor);
  }

  @Override
  @Transactional(readOnly = true)
  public UnreadCountDto unreadCount(UUID userId, String app) {
    return new UnreadCountDto(
        notificationRepository.countByUserIdAndAudienceInAndReadAtIsNull(userId, audiences(app)));
  }

  @Override
  public void markRead(UUID userId, UUID notificationId) {
    Notification notification =
        notificationRepository
            .findByIdAndUserId(notificationId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("Notification", notificationId));
    if (notification.getReadAt() == null) {
      notification.setReadAt(clock.instant());
    }
  }

  @Override
  public void markAllRead(UUID userId, String app) {
    notificationRepository.markAllRead(userId, audiences(app), clock.instant());
  }

  /**
   * The audiences a client's center lists: its own plus {@code all}.
   *
   * @param app the client wire value
   * @return the audiences
   */
  static List<NotificationAudience> audiences(String app) {
    ClientType client;
    try {
      client = ClientType.fromValue(app);
    } catch (IllegalArgumentException | NullPointerException ex) {
      throw new InvalidRequestException("Unknown app: " + app);
    }
    NotificationAudience own =
        switch (client) {
          case RIDER -> NotificationAudience.RIDER;
          case DRIVER -> NotificationAudience.DRIVER;
          case ADMIN -> NotificationAudience.ADMIN;
        };
    return List.of(own, NotificationAudience.ALL);
  }

  private static NotificationCategory category(String category) {
    if (category == null || category.isBlank()) {
      return null;
    }
    try {
      return NotificationCategory.fromValue(category);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown category: " + category);
    }
  }

  private Language language(UUID userId) {
    return userRepository.findById(userId).map(User::getLanguage).orElse(Language.EN);
  }

  private static NotificationDto toDto(Notification row, Language language) {
    boolean arabic = language == Language.AR;
    DeepLinkDto link =
        row.getLinkScreen() == null
            ? null
            : new DeepLinkDto(
                row.getLinkScreen(),
                row.getLinkParams() == null ? Map.of() : Map.copyOf(row.getLinkParams()));
    return new NotificationDto(
        row.getId(),
        row.getCategory(),
        row.getEvent(),
        arabic ? row.getTitleAr() : row.getTitleEn(),
        arabic ? row.getBodyAr() : row.getBodyEn(),
        link,
        row.getReadAt() != null,
        row.getCreatedAt());
  }

  /** The opaque page cursor: the last row's (created_at in microseconds, id). */
  private record Cursor(Instant createdAt, UUID id) {

    static String encode(Notification row) {
      Instant at = row.getCreatedAt().truncatedTo(ChronoUnit.MICROS);
      long micros = ChronoUnit.MICROS.between(Instant.EPOCH, at);
      String raw = micros + "_" + row.getId();
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    static Cursor decode(String cursor) {
      try {
        String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
        int separator = raw.indexOf('_');
        long micros = Long.parseLong(raw.substring(0, separator));
        return new Cursor(
            Instant.EPOCH.plus(micros, ChronoUnit.MICROS),
            UUID.fromString(raw.substring(separator + 1)));
      } catch (IllegalArgumentException | IndexOutOfBoundsException ex) {
        throw new InvalidRequestException("Malformed cursor");
      }
    }
  }
}
