package com.labby.backend.service;

/**
 * Drains the notification outbox (NTF-01..03, UC-S-25): every queued event — including M5's
 * onboarding events queued before M6 (the "backfill hook") — becomes exactly one
 * notification-center row and, unless muted, a push to the user's devices of its audience.
 */
public interface NotificationDispatchService {

  /**
   * Delivers one batch of undelivered entries, oldest first. A failure on one entry is logged and
   * retried on the next run; it never blocks the others.
   *
   * @return the number of entries marked delivered
   */
  int dispatchPending();
}
