package com.labby.backend.controller;

import com.labby.backend.dto.AdminReportDto;
import com.labby.backend.dto.AdminReportPageDto;
import com.labby.backend.dto.ReportResolveRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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

/** The admin reports queue (trust-v1.yaml AdminReports: REP-02, UC-A-17). */
@RestController
@RequestMapping("/api/v1/admin/reports")
@Tag(name = "AdminReports", description = "Reports queue, evidence and resolution")
@RequiredArgsConstructor
public class AdminReportsController {

  private final ReportService reportService;

  /**
   * The reports queue, oldest first.
   *
   * @param status open (default), substantiated or unsubstantiated
   * @param reportedUserId optional reported-user filter
   * @param reporterUserId optional reporter filter (the reports the user filed, review V1 W4)
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('reports:view')")
  @Operation(summary = "Reports queue (UC-A-17)")
  public ResponseEntity<AdminReportPageDto> list(
      @RequestParam(required = false) String status,
      @RequestParam(required = false) UUID reportedUserId,
      @RequestParam(required = false) UUID reporterUserId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        reportService.adminList(
            status, reportedUserId, reporterUserId, Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  /**
   * One report with its photos and both parties' history.
   *
   * @param reportId the report
   * @return 200 with the detail; 404 unknown
   */
  @GetMapping("/{reportId}")
  @PreAuthorize("hasAuthority('reports:view')")
  @Operation(summary = "One report with evidence references and history")
  public ResponseEntity<AdminReportDto> detail(@PathVariable UUID reportId) {
    return ResponseEntity.ok(reportService.adminDetail(reportId));
  }

  /**
   * Resolves a report exactly once with notes (audited; the reporter learns the outcome only).
   *
   * @param reportId the report
   * @param request outcome and notes
   * @return 200 with the resolved report; 404 unknown; 409 already_resolved
   */
  @PostMapping("/{reportId}/resolve")
  @PreAuthorize("hasAuthority('reports:handle')")
  @Operation(summary = "Resolve a report substantiated / unsubstantiated (REP-02)")
  public ResponseEntity<AdminReportDto> resolve(
      @PathVariable UUID reportId, @Valid @RequestBody ReportResolveRequestDto request) {
    return ResponseEntity.ok(
        reportService.resolve(SecurityUtils.currentUserId(), reportId, request));
  }
}
