package com.labby.backend.service;

import com.labby.backend.config.TrustProperties;
import com.labby.backend.dto.AdminReportDto;
import com.labby.backend.dto.AdminReportPageDto;
import com.labby.backend.dto.AdminReportSummaryDto;
import com.labby.backend.dto.OwnReportDto;
import com.labby.backend.dto.OwnReportPageDto;
import com.labby.backend.dto.PartySummaryDto;
import com.labby.backend.dto.ReportHistoryDto;
import com.labby.backend.dto.ReportRequestDto;
import com.labby.backend.dto.ReportResolveRequestDto;
import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.dto.UploadedReportFileDto;
import com.labby.backend.enums.FlagKind;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.Report;
import com.labby.backend.model.ReportPhoto;
import com.labby.backend.model.Ride;
import com.labby.backend.model.StoredFile;
import com.labby.backend.model.User;
import com.labby.backend.repository.ReportPhotoRepository;
import com.labby.backend.repository.ReportRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.repository.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** The report workflow (see {@link ReportService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class ReportServiceImpl implements ReportService {

  /** REP-01 categories per direction (UC-S-18 mirrored categories). */
  static final Map<RideParty, Set<ReportCategory>> CATEGORIES =
      Map.of(
          RideParty.RIDER,
          Set.of(
              ReportCategory.UNSAFE_DRIVING,
              ReportCategory.INAPPROPRIATE_BEHAVIOR,
              ReportCategory.VEHICLE_CONDITION,
              ReportCategory.OTHER),
          RideParty.DRIVER,
          Set.of(
              ReportCategory.UNSAFE_BEHAVIOR,
              ReportCategory.INAPPROPRIATE_BEHAVIOR,
              ReportCategory.VEHICLE_DAMAGE,
              ReportCategory.OTHER));

  private final ReportRepository reportRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final ReportPhotoRepository reportPhotoRepository;
  private final RideRepository rideRepository;
  private final RideParties rideParties;
  private final UserRepository userRepository;
  private final StoredFileRepository storedFileRepository;
  private final DriverFileService driverFileService;
  private final StorageProvider storageProvider;
  private final AccountFlagService accountFlagService;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final TrustProperties trustProperties;
  private final Clock clock;

  @Override
  public UploadedReportFileDto uploadPhoto(UUID userId, MultipartFile file) {
    UploadedFileDto stored = driverFileService.uploadReportPhoto(userId, file);
    return new UploadedReportFileDto(stored.fileId(), stored.contentType(), stored.sizeBytes());
  }

  @Override
  public OwnReportDto submit(UUID userId, UUID rideId, ReportRequestDto request, UUID memberId) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    RideParty side = rideParties.sideOf(ride, userId, RideParties.RIDING);
    if (side == null) {
      throw new ForbiddenException("Not a party to this ride");
    }
    if (ride.getDriverUserId() == null) {
      throw conflict("This ride never had a driver to report", "no_counterpart");
    }
    if (!CATEGORIES.get(side).contains(request.category())) {
      throw (InvalidRequestException)
          new InvalidRequestException(
                  "This category is not available for a " + side.getValue() + " report")
              .withCode("invalid_category");
    }
    // M12: the driver of a shared ride reports one member — any who was with the ride after
    // dispatch (a no-show or a cancelled member included).
    UUID reportedUserId = rideParties.counterpart(ride, side, memberId, RideParties.DISPATCHED);
    if (reportRepository.existsByRideIdAndReporterUserIdAndReportedUserId(
        rideId, userId, reportedUserId)) {
      throw alreadyReported();
    }
    List<UUID> photoIds = request.photoFileIds() == null ? List.of() : request.photoFileIds();
    requireUsablePhotos(userId, photoIds);
    RideParty reportedRole = side.other();
    Report report;
    try {
      report =
          reportRepository.saveAndFlush(
              Report.builder()
                  .rideId(rideId)
                  .reporterUserId(userId)
                  .reporterRole(side)
                  .reportedUserId(reportedUserId)
                  .reportedRole(reportedRole)
                  .category(request.category())
                  .description(
                      request.description() == null || request.description().isBlank()
                          ? null
                          : request.description())
                  .createdAt(clock.instant())
                  .build());
      for (int position = 0; position < photoIds.size(); position++) {
        reportPhotoRepository.saveAndFlush(
            ReportPhoto.builder()
                .reportId(report.getId())
                .position((short) position)
                .storedFileId(photoIds.get(position))
                .build());
      }
    } catch (DataIntegrityViolationException ex) {
      // A concurrent submission won uq_reports_ride_reporter_reported, or a photo was used
      // meanwhile
      // (the failed statement aborted the transaction, so the constraint name decides).
      String cause = String.valueOf(ex.getMostSpecificCause().getMessage());
      if (cause.contains("uq_reports_ride_reporter_reported")) {
        throw alreadyReported();
      }
      throw new InvalidRequestException("A photo is already attached to another report");
    }
    return toOwnDto(report);
  }

  /** The photos must be the caller's own unused report-photo uploads, without repeats. */
  private void requireUsablePhotos(UUID userId, List<UUID> photoIds) {
    if (photoIds.size() > 3) {
      throw new InvalidRequestException("At most 3 photos per report");
    }
    if (new HashSet<>(photoIds).size() != photoIds.size()) {
      throw new InvalidRequestException("A photo is listed twice");
    }
    for (UUID photoId : photoIds) {
      boolean own =
          storedFileRepository
              .findByIdAndOwnerUserId(photoId, userId)
              .map(StoredFile::getKind)
              .filter(kind -> kind == StoredFileKind.REPORT_PHOTO)
              .isPresent();
      if (!own) {
        throw new InvalidRequestException("Unknown photo: upload it with /report-files first");
      }
      if (reportPhotoRepository.existsByStoredFileId(photoId)) {
        throw new InvalidRequestException("A photo is already attached to another report");
      }
    }
  }

  @Override
  @Transactional(readOnly = true)
  public OwnReportPageDto mine(UUID userId, String as, int page, int size) {
    RideParty side = RatingServiceImpl.parseSide(as);
    Page<Report> reports =
        reportRepository.findByReporterUserIdAndReporterRoleOrderByCreatedAtDesc(
            userId, side, PageRequest.of(page, size));
    return new OwnReportPageDto(
        reports.getContent().stream().map(ReportServiceImpl::toOwnDto).toList(),
        page,
        size,
        reports.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public AdminReportPageDto adminList(
      String status, UUID reportedUserId, UUID reporterUserId, int page, int size) {
    ReportStatus statusFilter;
    try {
      statusFilter =
          status == null || status.isBlank() ? ReportStatus.OPEN : ReportStatus.fromValue(status);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("Unknown status: " + status);
    }
    PageRequest pageRequest = PageRequest.of(page, size);
    Page<Report> reports;
    if (reporterUserId != null && reportedUserId != null) {
      reports =
          reportRepository.findByStatusAndReporterUserIdAndReportedUserIdOrderByCreatedAtAsc(
              statusFilter, reporterUserId, reportedUserId, pageRequest);
    } else if (reporterUserId != null) {
      reports =
          reportRepository.findByStatusAndReporterUserIdOrderByCreatedAtAsc(
              statusFilter, reporterUserId, pageRequest);
    } else if (reportedUserId != null) {
      reports =
          reportRepository.findByStatusAndReportedUserIdOrderByCreatedAtAsc(
              statusFilter, reportedUserId, pageRequest);
    } else {
      reports = reportRepository.findByStatusOrderByCreatedAtAsc(statusFilter, pageRequest);
    }
    Map<UUID, User> users = users(reports.getContent());
    return new AdminReportPageDto(
        reports.getContent().stream().map(report -> toSummary(report, users)).toList(),
        page,
        size,
        reports.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public AdminReportDto adminDetail(UUID reportId) {
    return toDetail(requireReport(reportId));
  }

  @Override
  public AdminReportDto resolve(UUID actorUserId, UUID reportId, ReportResolveRequestDto request) {
    Report report = requireReport(reportId);
    Instant now = clock.instant();
    if (report.getStatus() != ReportStatus.OPEN
        || reportRepository.resolveIfOpen(
                reportId, request.outcome(), request.note(), actorUserId, now)
            == 0) {
      throw conflict("This report is already resolved", "already_resolved");
    }
    Map<String, Object> after = new LinkedHashMap<>();
    after.put("status", request.outcome());
    after.put("note", request.note());
    auditService.record(
        actorUserId,
        "report.resolve",
        "report",
        reportId.toString(),
        Map.of("status", ReportStatus.OPEN.getValue()),
        after);
    // The reporter learns the OUTCOME only — the internal notes never leave the admin side.
    notificationService.queue(
        report.getReporterUserId(),
        NotificationEvent.REPORT_RESOLVED,
        Map.of("outcome", request.outcome(), "role", report.getReporterRole().getValue()));
    if (ReportStatus.SUBSTANTIATED.getValue().equals(request.outcome())) {
      evaluateReportThreshold(report.getReportedUserId(), report.getReportedRole(), now);
    }
    return toDetail(requireReport(reportId));
  }

  /** REP-03: the sliding window on the resolution moment; flag only, never a suspension. */
  private void evaluateReportThreshold(UUID userId, RideParty role, Instant now) {
    // Review B-W3: lock the reported role first, so two concurrent substantiations serialize and
    // the second one counts the first (a crossing is never missed).
    roleAssignmentRepository.findForUpdate(
        userId, role == RideParty.DRIVER ? Role.DRIVER : Role.RIDER);
    int days = trustProperties.reportFlagDays();
    List<Report> recent =
        reportRepository.findSubstantiatedSince(userId, role, now.minus(Duration.ofDays(days)));
    if (recent.size() < trustProperties.reportFlagCount()) {
      return;
    }
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("substantiatedCount", recent.size());
    details.put("windowDays", days);
    details.put("threshold", trustProperties.reportFlagCount());
    details.put("reportIds", recent.stream().map(report -> report.getId().toString()).toList());
    accountFlagService.open(userId, role, FlagKind.REPORT_THRESHOLD, details);
  }

  @Override
  @Transactional(readOnly = true)
  public ReportHistoryDto history(UUID userId, RideParty role) {
    return new ReportHistoryDto(
        reportRepository.countByReportedUserIdAndReportedRole(userId, role),
        reportRepository.countByReportedUserIdAndReportedRoleAndStatus(
            userId, role, ReportStatus.SUBSTANTIATED),
        reportRepository.countByReporterUserIdAndReporterRole(userId, role));
  }

  private Report requireReport(UUID reportId) {
    return reportRepository
        .findById(reportId)
        .orElseThrow(() -> new ResourceNotFoundException("Report not found"));
  }

  private AdminReportDto toDetail(Report report) {
    Map<UUID, User> users = users(List.of(report));
    AdminReportSummaryDto summary = toSummary(report, users);
    List<String> photoUrls =
        reportPhotoRepository.findByReportIdOrderByPositionAsc(report.getId()).stream()
            .map(photo -> storedFileRepository.findById(photo.getStoredFileId()).orElseThrow())
            .map(
                file ->
                    storageProvider.accessUrl(file.getStorageKey(), file.getContentType()).url())
            .toList();
    User resolver = report.getResolvedBy() == null ? null : users.get(report.getResolvedBy());
    // UC-A-17 step 2: each party's PRIOR history in its role on this report — this one excluded.
    ReportHistoryDto reporterHistory =
        history(report.getReporterUserId(), report.getReporterRole());
    ReportHistoryDto reportedHistory =
        history(report.getReportedUserId(), report.getReportedRole());
    boolean substantiated = report.getStatus() == ReportStatus.SUBSTANTIATED;
    return new AdminReportDto(
        summary.id(),
        summary.rideId(),
        summary.category(),
        summary.status(),
        summary.reporter(),
        summary.reported(),
        summary.createdAt(),
        summary.resolvedAt(),
        summary.photoCount(),
        report.getDescription(),
        photoUrls,
        report.getResolutionNote(),
        report.getResolvedBy() == null
            ? null
            : new AdminReportDto.ResolvedByDto(
                report.getResolvedBy(), resolver == null ? "" : resolver.getName()),
        new ReportHistoryDto(
            reporterHistory.reportsAgainst(),
            reporterHistory.substantiatedAgainst(),
            reporterHistory.reportsFiled() - 1),
        new ReportHistoryDto(
            reportedHistory.reportsAgainst() - 1,
            reportedHistory.substantiatedAgainst() - (substantiated ? 1 : 0),
            reportedHistory.reportsFiled()));
  }

  private AdminReportSummaryDto toSummary(Report report, Map<UUID, User> users) {
    return new AdminReportSummaryDto(
        report.getId(),
        report.getRideId(),
        report.getCategory(),
        report.getStatus(),
        party(report.getReporterUserId(), report.getReporterRole(), users),
        party(report.getReportedUserId(), report.getReportedRole(), users),
        report.getCreatedAt(),
        report.getResolvedAt(),
        reportPhotoRepository.countByReportId(report.getId()));
  }

  private Map<UUID, User> users(List<Report> reports) {
    Set<UUID> ids = new HashSet<>();
    for (Report report : reports) {
      ids.add(report.getReporterUserId());
      ids.add(report.getReportedUserId());
      if (report.getResolvedBy() != null) {
        ids.add(report.getResolvedBy());
      }
    }
    return userRepository.findAllById(ids).stream()
        .collect(Collectors.toMap(User::getId, Function.identity()));
  }

  private static PartySummaryDto party(UUID userId, RideParty role, Map<UUID, User> users) {
    User user = users.get(userId);
    return new PartySummaryDto(userId, user == null ? "" : user.getName(), role);
  }

  private static OwnReportDto toOwnDto(Report report) {
    return new OwnReportDto(
        report.getId(),
        report.getRideId(),
        report.getCategory(),
        report.getStatus(),
        report.getCreatedAt(),
        report.getResolvedAt());
  }

  private static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }

  private static ConflictException alreadyReported() {
    return conflict("You already reported this ride", "report_already_submitted");
  }
}
