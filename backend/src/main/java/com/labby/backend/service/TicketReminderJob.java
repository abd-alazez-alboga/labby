package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the waiting_on_user reminder pass on {@code labby.support.reminder-cron} ({@code
 * SUPPORT_REMINDER_CRON}) in the operating timezone. All logic lives in {@link
 * TicketReminderService}; {@code -} disables the trigger.
 */
@Component
@RequiredArgsConstructor
public class TicketReminderJob {

  private final TicketReminderService ticketReminderService;

  /** Runs one reminder pass. */
  @Scheduled(cron = "${labby.support.reminder-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    ticketReminderService.runReminderPass();
  }
}
