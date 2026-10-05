package com.labby.backend.service;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.FileAccessUrlDto;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.security.FileUrlSigner;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;

/**
 * Stores private uploads under {@code STORAGE_DIR} on the local disk (NFR-S2). The directory is
 * never served; expiring access URLs point at {@code GET /api/v1/files/{token}}, which only accepts
 * tokens signed by {@link FileUrlSigner}.
 */
@Service
public class LocalDiskStorageProvider implements StorageProvider {

  static final String FILES_PATH = "/api/v1/files/";

  private final Path root;
  private final long urlTtlSeconds;
  private final FileUrlSigner fileUrlSigner;
  private final Clock clock;

  public LocalDiskStorageProvider(
      StorageProperties storageProperties, FileUrlSigner fileUrlSigner, Clock clock) {
    this.root = Path.of(storageProperties.dir()).toAbsolutePath().normalize();
    this.urlTtlSeconds = storageProperties.urlTtlSeconds();
    this.fileUrlSigner = fileUrlSigner;
    this.clock = clock;
  }

  @Override
  public String store(String key, byte[] content) {
    Path target = resolve(key);
    try {
      Files.createDirectories(target.getParent());
      Files.write(target, content);
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to store upload", ex);
    }
    return key;
  }

  @Override
  public byte[] load(String key) {
    Path target = resolve(key);
    if (!Files.exists(target)) {
      throw new ResourceNotFoundException("Stored file '%s' was not found".formatted(key));
    }
    try {
      return Files.readAllBytes(target);
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to read upload", ex);
    }
  }

  @Override
  public FileAccessUrlDto accessUrl(String key, String contentType) {
    resolve(key);
    Instant expiresAt = clock.instant().plusSeconds(urlTtlSeconds);
    return new FileAccessUrlDto(
        FILES_PATH + fileUrlSigner.sign(key, contentType, expiresAt), expiresAt);
  }

  private Path resolve(String key) {
    Path target = root.resolve(key).normalize();
    if (!target.startsWith(root)) {
      throw new IllegalArgumentException("Storage key escapes the storage root");
    }
    return target;
  }
}
