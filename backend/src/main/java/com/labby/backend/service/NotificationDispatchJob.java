package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the outbox dispatcher on {@code labby.notifications.dispatch-cron} ({@code
 * NOTIFICATIONS_DISPATCH_CRON}, default every 5 s). All logic lives in {@link
 * NotificationDispatchService}; {@code -} disables the trigger (tests call the service directly).
 */
@Component
@RequiredArgsConstructor
public class NotificationDispatchJob {

  private final NotificationDispatchService notificationDispatchService;

  /** Runs one dispatch pass. */
  @Scheduled(cron = "${labby.notifications.dispatch-cron}")
  public void run() {
    notificationDispatchService.dispatchPending();
  }
}
