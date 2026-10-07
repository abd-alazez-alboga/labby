package com.labby.backend.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the nightly orphan-upload cleanup on {@code labby.storage.orphan-cleanup-cron} ({@code
 * STORAGE_ORPHAN_CLEANUP_CRON}) in the operating timezone. All logic lives in {@link
 * OrphanFileCleanupService}; {@code -} disables the trigger.
 */
@Component
@RequiredArgsConstructor
public class OrphanFileCleanupJob {

  private final OrphanFileCleanupService orphanFileCleanupService;

  /** Runs one cleanup pass. */
  @Scheduled(cron = "${labby.storage.orphan-cleanup-cron}", zone = "${labby.onboarding.timezone}")
  public void run() {
    orphanFileCleanupService.runCleanup();
  }
}
