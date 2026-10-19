package com.labby.backend.controller;

import com.labby.backend.dto.CsvFileDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminExportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * CSV export of the five key lists (analytics-v1.yaml AdminExports: ADM-06, UC-A-31). Each endpoint
 * takes exactly its list's query parameters, parsed by the same {@link AdminListFilters} method,
 * and needs {@code analytics:export} plus the list's own view permission.
 */
@RestController
@RequestMapping("/api/v1/admin/exports")
@Tag(name = "AdminExports", description = "CSV export of the admin lists")
@RequiredArgsConstructor
public class AdminExportsController {

  private static final MediaType CSV = new MediaType("text", "csv", StandardCharsets.UTF_8);

  private final AdminExportService adminExportService;

  /**
   * The rides list as CSV (rides-v1 {@code GET /admin/rides} filters).
   *
   * @return 200 with the file
   */
  @GetMapping("/rides")
  @PreAuthorize("hasAuthority('analytics:export') and hasAuthority('rides:view')")
  @Operation(summary = "Export the rides list (UC-A-31)")
  public ResponseEntity<byte[]> rides(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) String state,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) String phone,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to) {
    return file(
        adminExportService.rides(
            SecurityUtils.currentUserId(),
            AdminListFilters.rides(regionId, state, kind, userId, phone, from, to)));
  }

  /**
   * The users list as CSV.
   *
   * @return 200 with the file
   */
  @GetMapping("/users")
  @PreAuthorize("hasAuthority('analytics:export') and hasAuthority('users:view')")
  @Operation(summary = "Export the users list (UC-A-31)")
  public ResponseEntity<byte[]> users(
      @RequestParam(required = false) String role,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to,
      Authentication authentication) {
    return file(
        adminExportService.users(
            SecurityUtils.currentUserId(),
            AdminListFilters.users(role, from, to),
            contactAccess(authentication)));
  }

  /**
   * The drivers list as CSV.
   *
   * @return 200 with the file
   */
  @GetMapping("/drivers")
  @PreAuthorize("hasAuthority('analytics:export') and hasAuthority('users:view')")
  @Operation(summary = "Export the drivers list (UC-A-31)")
  public ResponseEntity<byte[]> drivers(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Boolean online,
      Authentication authentication) {
    return file(
        adminExportService.drivers(
            SecurityUtils.currentUserId(),
            AdminListFilters.drivers(regionId, status, online),
            contactAccess(authentication)));
  }

  /**
   * The transactions list as CSV.
   *
   * @return 200 with the file
   */
  @GetMapping("/transactions")
  @PreAuthorize(
      "hasAuthority('analytics:export') and hasAuthority('wallets:view')"
          + " and hasAuthority('settlements:view')")
  @Operation(summary = "Export the transactions list (UC-A-31)")
  public ResponseEntity<byte[]> transactions(
      @RequestParam(required = false) String source,
      @RequestParam(required = false) String type,
      @RequestParam(required = false) String currency,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to) {
    return file(
        adminExportService.transactions(
            SecurityUtils.currentUserId(),
            AdminListFilters.transactions(source, type, currency, userId, from, to)));
  }

  /**
   * The ticket queue as CSV (support-v1 {@code GET /admin/tickets} filters).
   *
   * @return 200 with the file
   */
  @GetMapping("/tickets")
  @PreAuthorize("hasAuthority('analytics:export') and hasAuthority('support:view')")
  @Operation(summary = "Export the ticket queue (UC-A-31)")
  public ResponseEntity<byte[]> tickets(
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) List<String> status,
      @RequestParam(required = false) String priority,
      @RequestParam(required = false) UUID categoryId,
      @RequestParam(required = false) UUID assigneeUserId,
      @RequestParam(required = false) Boolean unassigned,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) UUID rideId) {
    return file(
        adminExportService.tickets(
            SecurityUtils.currentUserId(),
            AdminListFilters.tickets(
                kind, status, priority, categoryId, assigneeUserId, unassigned, userId, rideId)));
  }

  private static ResponseEntity<byte[]> file(CsvFileDto csv) {
    return ResponseEntity.ok()
        .contentType(CSV)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename(csv.filename()).build().toString())
        .body(csv.content());
  }

  private static boolean contactAccess(Authentication authentication) {
    return SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue());
  }
}
