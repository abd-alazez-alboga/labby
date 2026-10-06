package com.labby.backend.service;

import com.labby.backend.enums.NotificationEvent;
import java.util.Map;
import java.util.UUID;

/**
 * The notification seam: every onboarding stage change is queued here for the account (M5).
 * Delivery to the notification center + push arrives with M6, which drains the queue.
 */
public interface NotificationService {

  /**
   * Queues a notification for later delivery, inside the caller's transaction (so a rolled-back
   * stage change never notifies).
   *
   * @param userId the recipient account
   * @param event the template key
   * @param params the template arguments (JSON-serializable scalars)
   */
  void queue(UUID userId, NotificationEvent event, Map<String, Object> params);

  /**
   * Queues a notification without template arguments.
   *
   * @param userId the recipient account
   * @param event the template key
   */
  default void queue(UUID userId, NotificationEvent event) {
    queue(userId, event, Map.of());
  }
}
