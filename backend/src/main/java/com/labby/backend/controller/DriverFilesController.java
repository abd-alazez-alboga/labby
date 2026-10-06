package com.labby.backend.controller;

import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverFileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Private driver uploads per the M5 contract (backend/docs/api/onboarding-v1.yaml, NFR-S2). */
@RestController
@RequestMapping("/api/v1/driver/files")
@Tag(name = "Files", description = "Private driver uploads (NFR-S2)")
@RequiredArgsConstructor
public class DriverFilesController {

  private final DriverFileService driverFileService;

  /**
   * Uploads a document file (JPEG/PNG/PDF) or vehicle photo (JPEG/PNG); the type is detected from
   * the content.
   *
   * @param file the multipart file
   * @param kind {@code document} or {@code vehicle_photo}
   * @return 201 with the stored file, usable only by the uploader
   */
  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(summary = "Upload a document file or vehicle photo")
  public ResponseEntity<UploadedFileDto> upload(
      @RequestParam(value = "file", required = false) MultipartFile file,
      @RequestParam(value = "kind", required = false) String kind) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(driverFileService.upload(SecurityUtils.currentUserId(), kind, file));
  }
}
