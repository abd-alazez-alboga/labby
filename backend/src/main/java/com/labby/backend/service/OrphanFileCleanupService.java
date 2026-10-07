package com.labby.backend.service;

/**
 * The nightly cleanup of driver uploads that nothing references (owner decision 2026-10-07): a file
 * no document and no vehicle photo uses, older than {@code STORAGE_ORPHAN_FILE_RETENTION_DAYS}, is
 * deleted — its row and its bytes — so abandoned scans do not linger in private storage.
 */
public interface OrphanFileCleanupService {

  /**
   * Runs one cleanup pass.
   *
   * @return how many files were deleted
   */
  int runCleanup();
}
