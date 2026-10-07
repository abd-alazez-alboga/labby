package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.FileAccessUrlDto;
import com.labby.backend.security.FileUrlSigner;
import com.labby.backend.service.LocalDiskStorageProvider;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** NFR-S2: the local provider stores privately and mints expiring, verifiable access URLs. */
class LocalDiskStorageProviderTest {

  private static final Instant NOW = Instant.parse("2026-10-06T10:00:00Z");

  @TempDir Path root;

  @Test
  @DisplayName("access URL points at /api/v1/files/{token}, expires after the TTL, and verifies")
  void shouldMintExpiringAccessUrl() {
    Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    FileUrlSigner signer =
        new FileUrlSigner(
            new AuthProperties("unit-test-secret-0123456789abcdef0123", 900, 1_209_600, 10, 900),
            clock);
    LocalDiskStorageProvider provider =
        new LocalDiskStorageProvider(
            new StorageProperties(root.toString(), 5_242_880, 10_485_760, 300, 50, 7),
            signer,
            clock);
    provider.store("driver-files/a.png", new byte[] {1, 2, 3});

    FileAccessUrlDto access = provider.accessUrl("driver-files/a.png", "image/png");

    assertThat(access.expiresAt()).isEqualTo(NOW.plusSeconds(300));
    assertThat(access.url()).startsWith("/api/v1/files/");
    String token = access.url().substring("/api/v1/files/".length());
    assertThat(signer.verify(token))
        .contains(new FileUrlSigner.SignedFile("driver-files/a.png", "image/png"));
    assertThat(provider.load("driver-files/a.png")).containsExactly(1, 2, 3);
  }

  @Test
  @DisplayName("keys escaping the storage root are refused for URLs as for reads")
  void shouldRefuseEscapingKeys() {
    Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    LocalDiskStorageProvider provider =
        new LocalDiskStorageProvider(
            new StorageProperties(root.toString(), 5_242_880, 10_485_760, 300, 50, 7),
            new FileUrlSigner(
                new AuthProperties(
                    "unit-test-secret-0123456789abcdef0123", 900, 1_209_600, 10, 900),
                clock),
            clock);

    assertThatThrownBy(() -> provider.accessUrl("../etc/passwd", "image/png"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> provider.load("../etc/passwd"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
