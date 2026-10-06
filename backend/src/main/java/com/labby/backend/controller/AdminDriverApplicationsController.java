package com.labby.backend.controller;

import com.labby.backend.dto.AdminDriverApplicationDto;
import com.labby.backend.dto.ApplicationSummaryPageDto;
import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.RequestChangesRequestDto;
import com.labby.backend.dto.ServiceTypeRefDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverApplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Driver application review (UC-A-10) per onboarding-v1.yaml; reads need {@code
 * driver-review:view}, decisions {@code driver-review:decide} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "AdminApplications", description = "Driver application review (UC-A-10)")
@RequiredArgsConstructor
public class AdminDriverApplicationsController {

  private final DriverApplicationService driverApplicationService;

  /**
   * The application queue, oldest submission first.
   *
   * @param status repeatable stage filter; default submitted + under_review
   * @param page zero-based page index
   * @param size page size (1..100)
   * @return 200 with the page
   */
  @GetMapping("/driver-applications")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Application queue")
  public ResponseEntity<ApplicationSummaryPageDto> listApplications(
      @RequestParam(required = false) List<String> status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int size) {
    int boundedSize = Math.min(Math.max(size, 1), 100);
    int boundedPage = Math.max(page, 0);
    return ResponseEntity.ok(
        driverApplicationService.listApplications(status, boundedPage, boundedSize));
  }

  /**
   * One application with documents, vehicle and history (fresh file URLs).
   *
   * @param applicationId the driver profile id
   * @return 200 with the application
   */
  @GetMapping("/driver-applications/{applicationId}")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Application detail with documents, vehicle and history")
  public ResponseEntity<AdminDriverApplicationDto> getApplication(
      @PathVariable UUID applicationId) {
    return ResponseEntity.ok(driverApplicationService.getApplication(applicationId));
  }

  /**
   * Moves a submitted application to under_review.
   *
   * @param applicationId the driver profile id
   * @return 200 with the application
   */
  @PostMapping("/driver-applications/{applicationId}/start-review")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Move a submitted application to under_review")
  public ResponseEntity<AdminDriverApplicationDto> startReview(@PathVariable UUID applicationId) {
    return ResponseEntity.ok(
        driverApplicationService.startReview(SecurityUtils.currentUserId(), applicationId));
  }

  /**
   * Requests per-item changes.
   *
   * @param applicationId the driver profile id
   * @param request the flagged items with notes
   * @return 200 with the application
   */
  @PostMapping("/driver-applications/{applicationId}/request-changes")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Request per-item changes")
  public ResponseEntity<AdminDriverApplicationDto> requestChanges(
      @PathVariable UUID applicationId, @Valid @RequestBody RequestChangesRequestDto request) {
    return ResponseEntity.ok(
        driverApplicationService.requestChanges(
            SecurityUtils.currentUserId(), applicationId, request));
  }

  /**
   * Approves: assigns service types, activates the vehicle and the driver role.
   *
   * @param applicationId the driver profile id
   * @param request the service types
   * @return 200 with the application
   */
  @PostMapping("/driver-applications/{applicationId}/approve")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Approve — assign service types, activate the vehicle and driver role")
  public ResponseEntity<AdminDriverApplicationDto> approve(
      @PathVariable UUID applicationId, @Valid @RequestBody ApproveRequestDto request) {
    return ResponseEntity.ok(
        driverApplicationService.approve(SecurityUtils.currentUserId(), applicationId, request));
  }

  /**
   * Rejects with a reason.
   *
   * @param applicationId the driver profile id
   * @param request the reason
   * @return 200 with the application
   */
  @PostMapping("/driver-applications/{applicationId}/reject")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Reject with a reason")
  public ResponseEntity<AdminDriverApplicationDto> reject(
      @PathVariable UUID applicationId, @Valid @RequestBody ReasonRequestDto request) {
    return ResponseEntity.ok(
        driverApplicationService.reject(SecurityUtils.currentUserId(), applicationId, request));
  }

  /**
   * Service types an approval may assign: enabled types of active regions.
   *
   * @return 200 with region-then-name sorted types
   */
  @GetMapping("/assignable-service-types")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Service types an approval may assign")
  public ResponseEntity<List<ServiceTypeRefDto>> assignableServiceTypes() {
    return ResponseEntity.ok(driverApplicationService.assignableServiceTypes());
  }
}
