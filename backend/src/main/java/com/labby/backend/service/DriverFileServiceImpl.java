package com.labby.backend.service;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.PayloadTooLargeException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.StoredFile;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.util.FileSignatures;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Validates and stores driver uploads. The type comes from the content's magic bytes (the client's
 * Content-Type is ignored); PDFs are documents only; the key is server-generated ({@code
 * driver-files/<uuid>.<ext>}) so nothing client-supplied reaches the storage path. A user may
 * upload at most {@code STORAGE_DRIVER_FILE_DAILY_CAP} files per rolling 24 h (429 beyond it).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class DriverFileServiceImpl implements DriverFileService {

  private static final String KEY_PREFIX = "driver-files/";

  private final StoredFileRepository storedFileRepository;
  private final StorageProvider storageProvider;
  private final StorageProperties storageProperties;
  private final Clock clock;

  @Override
  public UploadedFileDto upload(UUID userId, String kind, MultipartFile file) {
    StoredFileKind fileKind = parseKind(kind);
    long recent =
        storedFileRepository.countByOwnerUserIdAndCreatedAtAfter(
            userId, clock.instant().minus(Duration.ofDays(1)));
    if (recent >= storageProperties.driverFileDailyCap()) {
      throw new TooManyRequestsException("Daily upload limit reached; try again later");
    }
    if (file == null || file.isEmpty()) {
      throw new InvalidRequestException("A non-empty file is required");
    }
    if (file.getSize() > storageProperties.driverFileMaxBytes()) {
      throw new PayloadTooLargeException("File exceeds the maximum allowed size");
    }
    byte[] content;
    try {
      content = file.getBytes();
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to read upload", ex);
    }
    String contentType =
        FileSignatures.detect(content)
            .orElseThrow(
                () -> new InvalidRequestException("Unsupported file type; use JPEG, PNG or PDF"));
    if (fileKind == StoredFileKind.VEHICLE_PHOTO && FileSignatures.PDF.equals(contentType)) {
      throw new InvalidRequestException("Vehicle photos must be JPEG or PNG");
    }

    String key =
        storageProvider.store(
            KEY_PREFIX + UUID.randomUUID() + FileSignatures.extensionOf(contentType), content);
    StoredFile stored =
        storedFileRepository.save(
            StoredFile.builder()
                .ownerUserId(userId)
                .kind(fileKind)
                .storageKey(key)
                .contentType(contentType)
                .sizeBytes(content.length)
                .build());
    return new UploadedFileDto(
        stored.getId(), stored.getKind(), stored.getContentType(), stored.getSizeBytes());
  }

  private static StoredFileKind parseKind(String kind) {
    if (kind == null || kind.isBlank()) {
      throw new InvalidRequestException("kind is required: document or vehicle_photo");
    }
    try {
      return StoredFileKind.fromValue(kind);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown kind; use document or vehicle_photo");
    }
  }
}
