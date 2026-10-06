package com.labby.backend.controller;

import com.labby.backend.dto.DocumentRenewalDto;
import com.labby.backend.dto.ExpiryDashboardDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverDocumentService;
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
 * Document renewals and the expiry dashboard (UC-A-12) per onboarding-v1.yaml; reads need {@code
 * driver-review:view}, decisions {@code driver-review:decide} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "AdminDocuments", description = "Document renewals and expiry dashboard (UC-A-12)")
@RequiredArgsConstructor
public class AdminDocumentsController {

  private final DriverDocumentService driverDocumentService;

  /**
   * The pending renewal queue, oldest first.
   *
   * @return 200 with the queue
   */
  @GetMapping("/document-renewals")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Pending renewal queue")
  public ResponseEntity<List<DocumentRenewalDto>> listRenewals() {
    return ResponseEntity.ok(driverDocumentService.listRenewals());
  }

  /**
   * One pending renewal beside the document it replaces (fresh file URLs).
   *
   * @param documentId the renewal
   * @return 200 with the renewal
   */
  @GetMapping("/document-renewals/{documentId}")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "One pending renewal beside the document it replaces")
  public ResponseEntity<DocumentRenewalDto> getRenewal(@PathVariable UUID documentId) {
    return ResponseEntity.ok(driverDocumentService.getRenewal(documentId));
  }

  /**
   * Approves a renewal; may lift an expiry suspension.
   *
   * @param documentId the renewal
   * @return 200 with the renewal
   */
  @PostMapping("/document-renewals/{documentId}/approve")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Approve a renewal")
  public ResponseEntity<DocumentRenewalDto> approveRenewal(@PathVariable UUID documentId) {
    return ResponseEntity.ok(
        driverDocumentService.approveRenewal(SecurityUtils.currentUserId(), documentId));
  }

  /**
   * Rejects a renewal with a reason; the current document stays.
   *
   * @param documentId the renewal
   * @param request the reason
   * @return 200 with the renewal
   */
  @PostMapping("/document-renewals/{documentId}/reject")
  @PreAuthorize("hasAuthority('driver-review:decide')")
  @Operation(summary = "Reject a renewal with a reason")
  public ResponseEntity<DocumentRenewalDto> rejectRenewal(
      @PathVariable UUID documentId, @Valid @RequestBody ReasonRequestDto request) {
    return ResponseEntity.ok(
        driverDocumentService.rejectRenewal(SecurityUtils.currentUserId(), documentId, request));
  }

  /**
   * The expiry dashboard: upcoming within the horizon, and already expired.
   *
   * @param horizonDays 1..30, default 30
   * @return 200 with the dashboard
   */
  @GetMapping("/document-expiries")
  @PreAuthorize("hasAuthority('driver-review:view')")
  @Operation(summary = "Expiry dashboard")
  public ResponseEntity<ExpiryDashboardDto> expiryDashboard(
      @RequestParam(defaultValue = "30") int horizonDays) {
    return ResponseEntity.ok(driverDocumentService.expiryDashboard(horizonDays));
  }
}
