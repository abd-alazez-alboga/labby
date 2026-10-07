package com.labby.backend.service;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.model.StoredFile;
import com.labby.backend.repository.StoredFileRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

/**
 * Deletes orphaned uploads in batches. Each row is deleted in its own repository transaction BEFORE
 * its bytes: a file that got referenced meanwhile fails the delete on its foreign key and is kept,
 * bytes included.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrphanFileCleanupServiceImpl implements OrphanFileCleanupService {

  static final int BATCH_SIZE = 200;

  private final StoredFileRepository storedFileRepository;
  private final StorageProvider storageProvider;
  private final StorageProperties storageProperties;
  private final Clock clock;

  @Override
  public int runCleanup() {
    Instant cutoff =
        clock.instant().minus(Duration.ofDays(storageProperties.orphanFileRetentionDays()));
    int deleted = 0;
    List<StoredFile> batch;
    do {
      batch = storedFileRepository.findOrphansCreatedBefore(cutoff, BATCH_SIZE);
      int deletedInBatch = 0;
      for (StoredFile file : batch) {
        try {
          storedFileRepository.deleteById(file.getId());
        } catch (DataAccessException ex) {
          // Referenced since the query (foreign key) — keep it, bytes included.
          log.warn("Orphan cleanup kept file {}: {}", file.getId(), ex.getMessage());
          continue;
        }
        storageProvider.delete(file.getStorageKey());
        deletedInBatch++;
      }
      deleted += deletedInBatch;
      if (deletedInBatch == 0) {
        break; // everything left in the batch is now referenced; do not spin
      }
    } while (batch.size() == BATCH_SIZE);
    if (deleted > 0) {
      log.info("Orphan upload cleanup deleted {} file(s)", deleted);
    }
    return deleted;
  }
}
