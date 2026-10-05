package com.labby.backend.controller;

import com.labby.backend.dto.SurchargeWindowDto;
import com.labby.backend.dto.SurchargeWindowUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SurchargeWindowService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin surcharge-window endpoints per the M4 contract (backend/docs/api/regions-v1.yaml);
 * pricing-flavored, so gated by {@code pricing:*} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "SurchargeWindows", description = "Per-region time-window surcharges (PRC-01)")
@RequiredArgsConstructor
public class SurchargeWindowsController {

  private final SurchargeWindowService surchargeWindowService;

  /**
   * Lists a region's time-window surcharges, ordered by start time.
   *
   * @param regionId the region
   * @return 200 with the windows
   */
  @GetMapping("/regions/{regionId}/surcharge-windows")
  @PreAuthorize("hasAuthority('pricing:view')")
  @Operation(summary = "List a region's time-window surcharges")
  public ResponseEntity<List<SurchargeWindowDto>> listSurchargeWindows(
      @PathVariable UUID regionId) {
    return ResponseEntity.ok(surchargeWindowService.listSurchargeWindows(regionId));
  }

  /**
   * Adds a time-window surcharge (PRC-01).
   *
   * @param regionId the region
   * @param request the window
   * @return 201 with the created window
   */
  @PostMapping("/regions/{regionId}/surcharge-windows")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Add a time-window surcharge")
  public ResponseEntity<SurchargeWindowDto> createSurchargeWindow(
      @PathVariable UUID regionId, @Valid @RequestBody SurchargeWindowUpsertRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            surchargeWindowService.createSurchargeWindow(
                SecurityUtils.currentUserId(), regionId, request));
  }

  /**
   * Edits a time-window surcharge.
   *
   * @param surchargeWindowId the window
   * @param request the replacement values
   * @return 200 with the updated window
   */
  @PutMapping("/surcharge-windows/{surchargeWindowId}")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Edit a time-window surcharge")
  public ResponseEntity<SurchargeWindowDto> updateSurchargeWindow(
      @PathVariable UUID surchargeWindowId,
      @Valid @RequestBody SurchargeWindowUpsertRequestDto request) {
    return ResponseEntity.ok(
        surchargeWindowService.updateSurchargeWindow(
            SecurityUtils.currentUserId(), surchargeWindowId, request));
  }

  /**
   * Deletes a time-window surcharge.
   *
   * @param surchargeWindowId the window
   * @return 204
   */
  @DeleteMapping("/surcharge-windows/{surchargeWindowId}")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Delete a time-window surcharge")
  public ResponseEntity<Void> deleteSurchargeWindow(@PathVariable UUID surchargeWindowId) {
    surchargeWindowService.deleteSurchargeWindow(SecurityUtils.currentUserId(), surchargeWindowId);
    return ResponseEntity.noContent().build();
  }
}
