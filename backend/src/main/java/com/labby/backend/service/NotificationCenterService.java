package com.labby.backend.service;

import com.labby.backend.dto.NotificationPageDto;
import com.labby.backend.dto.UnreadCountDto;
import java.util.UUID;

/**
 * The notification center (NTF-03, UC-S-11): server-stored, per client — a client's center lists
 * its own audience plus {@code all} — text in the caller's current language.
 */
public interface NotificationCenterService {

  /**
   * One page, newest first.
   *
   * @param userId the caller
   * @param app the calling client (rider, driver, admin)
   * @param category optional category filter
   * @param before optional cursor (the previous page's {@code nextCursor})
   * @param size page size (clamped to 1..50)
   * @return the page with the center's unread count
   */
  NotificationPageDto list(UUID userId, String app, String category, String before, int size);

  /**
   * The center's unread count.
   *
   * @param userId the caller
   * @param app the calling client
   * @return the count
   */
  UnreadCountDto unreadCount(UUID userId, String app);

  /**
   * Marks one of the caller's notifications read (idempotent).
   *
   * @param userId the caller
   * @param notificationId the notification
   * @throws com.labby.backend.exception.ResourceNotFoundException when unknown or not the caller's
   */
  void markRead(UUID userId, UUID notificationId);

  /**
   * Marks every notification of the client's center read.
   *
   * @param userId the caller
   * @param app the calling client
   */
  void markAllRead(UUID userId, String app);
}
