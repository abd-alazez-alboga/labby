package com.labby.backend.service;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.exception.ResourceNotFoundException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Service;

/** Stores private uploads under {@code STORAGE_DIR} on the local disk (NFR-S2). */
@Service
public class LocalDiskStorageProvider implements StorageProvider {

  private final Path root;

  public LocalDiskStorageProvider(StorageProperties storageProperties) {
    this.root = Path.of(storageProperties.dir()).toAbsolutePath().normalize();
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

  private Path resolve(String key) {
    Path target = root.resolve(key).normalize();
    if (!target.startsWith(root)) {
      throw new IllegalArgumentException("Storage key escapes the storage root");
    }
    return target;
  }
}
