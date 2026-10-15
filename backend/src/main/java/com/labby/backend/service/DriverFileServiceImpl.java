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

  /** REP-01 report photos (M11, {@code /report-files}): same rules, images only. */
  private static final String REPORT_KEY_PREFIX = "report-files/";

  private final StoredFileRepository storedFileRepository;
  private final StorageProvider storageProvider;
  private final StorageProperties storageProperties;
  private final Clock clock;

  @Override
  public UploadedFileDto upload(UUID userId, String kind, MultipartFile file) {
    return store(userId, parseKind(kind), file, KEY_PREFIX);
  }

  @Override
  public UploadedFileDto uploadReportPhoto(UUID userId, MultipartFile file) {
    return store(userId, StoredFileKind.REPORT_PHOTO, file, REPORT_KEY_PREFIX);
  }

  /**
   * The shared private-upload rules: rolling daily cap (counted over every kind), size cap, type
   * from the magic bytes, images only for photos, server-generated key.
   */
  private UploadedFileDto store(
      UUID userId, StoredFileKind fileKind, MultipartFile file, String keyPrefix) {
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
    if (fileKind == StoredFileKind.REPORT_PHOTO && FileSignatures.PDF.equals(contentType)) {
      throw new InvalidRequestException("Report photos must be JPEG or PNG");
    }

    String key =
        storageProvider.store(
            keyPrefix + UUID.randomUUID() + FileSignatures.extensionOf(contentType), content);
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
    StoredFileKind parsed;
    try {
      parsed = StoredFileKind.fromValue(kind);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown kind; use document or vehicle_photo");
    }
    if (parsed == StoredFileKind.REPORT_PHOTO) {
      // Report photos (M11) have their own endpoint, /report-files.
      throw new InvalidRequestException("Unknown kind; use document or vehicle_photo");
    }
    return parsed;
  }
}
