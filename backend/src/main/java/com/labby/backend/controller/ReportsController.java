package com.labby.backend.controller;

import com.labby.backend.dto.OwnReportDto;
import com.labby.backend.dto.OwnReportPageDto;
import com.labby.backend.dto.ReportRequestDto;
import com.labby.backend.dto.UploadedReportFileDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Reports for both apps (trust-v1.yaml Reports: REP-01, UC-S-18). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Reports", description = "Report a ride's counterpart with text and photos")
@RequiredArgsConstructor
public class ReportsController {

  private final ReportService reportService;

  /**
   * Uploads a report photo (JPEG/PNG) under the private-upload rules.
   *
   * @param file the multipart file
   * @return 201 with the stored file; 400 empty / not JPEG or PNG; 413 too large; 429 daily cap
   */
  @PostMapping(path = "/report-files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(summary = "Upload a report photo (JPEG/PNG)")
  public ResponseEntity<UploadedReportFileDto> upload(
      @RequestParam(value = "file", required = false) MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(reportService.uploadPhoto(SecurityUtils.currentUserId(), file));
  }

  /**
   * Reports the counterpart of a ride (once per ride, from acceptance on).
   *
   * @param rideId the ride
   * @param request category, text and photos
   * @return 201 with the reporter's view; 400 invalid_category / photos; 403 not a party; 404
   *     unknown ride; 409 no_counterpart or report_already_submitted
   */
  @PostMapping("/rides/{rideId}/reports")
  @Operation(summary = "Report the counterpart of a ride (UC-S-18)")
  public ResponseEntity<OwnReportDto> submit(
      @PathVariable UUID rideId, @Valid @RequestBody ReportRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(reportService.submit(SecurityUtils.currentUserId(), rideId, request));
  }

  /**
   * The caller's filed reports on a side, newest first — outcome only.
   *
   * @param as {@code rider} or {@code driver}
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping("/reports/mine")
  @Operation(summary = "Reports the caller filed — outcome only")
  public ResponseEntity<OwnReportPageDto> mine(
      @RequestParam("as") String as,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        reportService.mine(
            SecurityUtils.currentUserId(), as, Math.max(0, page), Math.clamp(size, 1, 100)));
  }
}
