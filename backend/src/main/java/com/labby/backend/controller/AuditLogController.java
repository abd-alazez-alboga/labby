package com.labby.backend.controller;

import com.labby.backend.dto.AuditLogPageDto;
import com.labby.backend.service.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Audit log query per the M3 contract (UC-A-04, RBAC-05). Read-only — no mutation exists. */
@RestController
@RequestMapping("/api/v1/admin/audit-log")
@Tag(name = "Audit", description = "Append-only audit log")
@RequiredArgsConstructor
public class AuditLogController {

  private final AuditService auditService;

  /**
   * Queries the audit log, newest first; all filters optional and combinable.
   *
   * @param actorId filter by acting admin
   * @param action exact action key, e.g. {@code role.update}
   * @param targetType target kind
   * @param targetId target identifier
   * @param from inclusive lower timestamp bound
   * @param to inclusive upper timestamp bound
   * @param page zero-based page index
   * @param size page size (1..100)
   * @return 200 with the page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('audit:view')")
  @Operation(summary = "Query the append-only audit log")
  public ResponseEntity<AuditLogPageDto> query(
      @RequestParam(required = false) UUID actorId,
      @RequestParam(required = false) String action,
      @RequestParam(required = false) String targetType,
      @RequestParam(required = false) String targetId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          OffsetDateTime from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          OffsetDateTime to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "25") int size) {
    int boundedSize = Math.min(Math.max(size, 1), 100);
    int boundedPage = Math.max(page, 0);
    return ResponseEntity.ok(
        auditService.query(
            actorId, action, targetType, targetId, from, to, boundedPage, boundedSize));
  }
}
