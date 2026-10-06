package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the daily document-expiry pass (DRV-04) on {@code labby.onboarding.expiry-job-cron}
 * ({@code ONBOARDING_EXPIRY_JOB_CRON}) in the operating timezone. All logic lives in {@link
 * DocumentExpiryService}; {@code -} disables the trigger.
 */
@Component
@RequiredArgsConstructor
public class DocumentExpiryJob {

  private final DocumentExpiryService documentExpiryService;

  /** Runs one expiry pass. */
  @Scheduled(cron = "${labby.onboarding.expiry-job-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    documentExpiryService.runExpiryCheck();
  }
}
