package com.labby.backend.service;

import com.labby.backend.dto.UploadedFileDto;
import java.util.UUID;
import org.springframework.web.multipart.MultipartFile;

/** Private driver uploads — document files and vehicle photos (DRV-01/03, NFR-S2). */
public interface DriverFileService {

  /**
   * Stores an upload privately under a server-generated key, owned by the uploader.
   *
   * @param userId the uploader
   * @param kind the wire kind ({@code document} or {@code vehicle_photo})
   * @param file the multipart file
   * @return the stored file
   * @throws com.labby.backend.exception.InvalidRequestException for a missing/empty file, an
   *     unknown kind, an unsupported type, or a PDF as a vehicle photo
   * @throws com.labby.backend.exception.PayloadTooLargeException when larger than {@code
   *     STORAGE_DRIVER_FILE_MAX_BYTES}
   */
  UploadedFileDto upload(UUID userId, String kind, MultipartFile file);
}
