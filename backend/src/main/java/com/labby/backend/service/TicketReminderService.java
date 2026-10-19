package com.labby.backend.service;

/**
 * The SUP-02 / UC-S-20 A1 reminder: a ticket in {@code waiting_on_user} for {@code
 * labby.support.waiting-reminder-hours} without a user reply gets ONE {@code
 * support.waiting_reminder} notification per stay (owner ruling 2026-10-19).
 */
public interface TicketReminderService {

  /**
   * One pass: every due ticket is reminded in its own transaction (a conflicting concurrent change
   * skips only that ticket, retried next run).
   *
   * @return the number of reminders queued
   */
  int runReminderPass();
}
