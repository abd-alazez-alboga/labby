package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.model.StoredFile;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.service.OrphanFileCleanupServiceImpl;
import com.labby.backend.service.StorageProvider;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

/** Nightly orphan-upload cleanup: row first, then bytes; a file referenced meanwhile is kept. */
@ExtendWith(MockitoExtension.class)
class OrphanFileCleanupServiceImplTest {

  private static final Instant NOW = Instant.parse("2026-10-07T03:30:00Z");

  @Mock private StoredFileRepository storedFileRepository;
  @Mock private StorageProvider storageProvider;

  private OrphanFileCleanupServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new OrphanFileCleanupServiceImpl(
            storedFileRepository,
            storageProvider,
            new StorageProperties("/tmp/unused", 1024, 16, 300, 50, 7),
            Clock.fixed(NOW, ZoneOffset.UTC));
  }

  private static StoredFile file(String key) {
    return StoredFile.builder()
        .id(UUID.randomUUID())
        .ownerUserId(UUID.randomUUID())
        .kind(StoredFileKind.DOCUMENT)
        .storageKey(key)
        .contentType("application/pdf")
        .sizeBytes(1)
        .build();
  }

  @Test
  @DisplayName("deletes orphans older than the retention: row, then bytes")
  void shouldDeleteOrphansOlderThanTheRetention() {
    StoredFile orphan = file("driver-files/a.pdf");
    when(storedFileRepository.findOrphansCreatedBefore(NOW.minus(Duration.ofDays(7)), 200))
        .thenReturn(List.of(orphan));

    assertThat(service.runCleanup()).isEqualTo(1);
    verify(storedFileRepository).deleteById(orphan.getId());
    verify(storageProvider).delete("driver-files/a.pdf");
  }

  @Test
  @DisplayName("a file referenced since the query fails its row delete and keeps its bytes")
  void shouldKeepAFileReferencedMeanwhile() {
    StoredFile raced = file("driver-files/b.pdf");
    when(storedFileRepository.findOrphansCreatedBefore(
            org.mockito.ArgumentMatchers.any(), anyInt()))
        .thenReturn(List.of(raced));
    doThrow(new DataIntegrityViolationException("fk"))
        .when(storedFileRepository)
        .deleteById(raced.getId());

    assertThat(service.runCleanup()).isZero();
    verify(storageProvider, never()).delete("driver-files/b.pdf");
  }
}
