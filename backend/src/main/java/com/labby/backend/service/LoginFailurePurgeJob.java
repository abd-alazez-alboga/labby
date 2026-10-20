package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Purges expired failed-login counters ({@code login_failures}, V32) on {@code
 * labby.auth.login-failure-purge-cron} ({@code LOGIN_FAILURE_PURGE_CRON}) in the operating
 * timezone. All logic lives in {@link LoginThrottle}; {@code -} disables the trigger.
 */
@Component
@RequiredArgsConstructor
public class LoginFailurePurgeJob {

  private final LoginThrottle loginThrottle;

  /** Runs one purge. */
  @Scheduled(cron = "${labby.auth.login-failure-purge-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    loginThrottle.purgeExpired();
  }
}
