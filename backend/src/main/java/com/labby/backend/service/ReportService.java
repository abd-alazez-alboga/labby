package com.labby.backend.service;

import com.labby.backend.dto.AdminReportDto;
import com.labby.backend.dto.AdminReportPageDto;
import com.labby.backend.dto.OwnReportDto;
import com.labby.backend.dto.OwnReportPageDto;
import com.labby.backend.dto.ReportHistoryDto;
import com.labby.backend.dto.ReportRequestDto;
import com.labby.backend.dto.ReportResolveRequestDto;
import com.labby.backend.dto.UploadedReportFileDto;
import com.labby.backend.enums.RideParty;
import java.util.UUID;
import org.springframework.web.multipart.MultipartFile;

/**
 * Reports (REP-01..03; trust-v1.yaml): a party reports the counterpart of a ride from acceptance
 * on, once per ride, with up to 3 photos; admins resolve each exactly once with internal notes; the
 * reporter learns the outcome only; {@code REPORT_FLAG_COUNT} substantiated reports within {@code
 * REPORT_FLAG_DAYS} open a {@code report_threshold} flag.
 */
public interface ReportService {

  /**
   * Stores a report photo (JPEG/PNG) privately for the uploader.
   *
   * @param userId the uploader
   * @param file the multipart file
   * @return the stored file
   */
  UploadedReportFileDto uploadPhoto(UUID userId, MultipartFile file);

  /**
   * Files a report of the ride's counterpart.
   *
   * @param userId the caller (a party of the ride)
   * @param rideId the ride
   * @param request category, text and photo ids
   * @return the reporter's view
   * @throws com.labby.backend.exception.ResourceNotFoundException unknown ride
   * @throws com.labby.backend.exception.ForbiddenException not a party
   * @throws com.labby.backend.exception.InvalidRequestException {@code invalid_category} or a bad
   *     photo id
   * @throws com.labby.backend.exception.ConflictException {@code no_counterpart}, {@code
   *     report_already_submitted}
   */
  OwnReportDto submit(UUID userId, UUID rideId, ReportRequestDto request);

  /**
   * The caller's filed reports on a side, newest first — outcome only.
   *
   * @param userId the caller
   * @param as {@code rider} or {@code driver}
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  OwnReportPageDto mine(UUID userId, String as, int page, int size);

  /**
   * The admin reports queue, oldest first.
   *
   * @param status {@code open} (default), {@code substantiated} or {@code unsubstantiated}
   * @param reportedUserId optional reported-user filter
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  AdminReportPageDto adminList(String status, UUID reportedUserId, int page, int size);

  /**
   * One report with photos and both parties' history.
   *
   * @param reportId the report
   * @return the detail
   */
  AdminReportDto adminDetail(UUID reportId);

  /**
   * Resolves an open report (audited), notifies the reporter of the outcome and, when
   * substantiated, re-evaluates REP-03 for the reported user x role.
   *
   * @param actorUserId the admin
   * @param reportId the report
   * @param request the outcome and internal notes
   * @return the resolved report
   * @throws com.labby.backend.exception.ConflictException {@code already_resolved}
   */
  AdminReportDto resolve(UUID actorUserId, UUID reportId, ReportResolveRequestDto request);

  /**
   * A user's report history in one role.
   *
   * @param userId the user
   * @param role the role
   * @return the history
   */
  ReportHistoryDto history(UUID userId, RideParty role);
}
