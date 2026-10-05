package com.labby.backend.controller;

import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SurgeZoneService;
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
 * Admin surge-zone endpoints per the M4 contract (backend/docs/api/regions-v1.yaml);
 * pricing-flavored, so gated by {@code pricing:*} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "SurgeZones", description = "Per-region surge zones (PRC-02)")
@RequiredArgsConstructor
public class SurgeZonesController {

  private final SurgeZoneService surgeZoneService;

  /**
   * Lists a region's surge zones.
   *
   * @param regionId the region
   * @return 200 with the zones
   */
  @GetMapping("/regions/{regionId}/surge-zones")
  @PreAuthorize("hasAuthority('pricing:view')")
  @Operation(summary = "List a region's surge zones")
  public ResponseEntity<List<SurgeZoneDto>> listSurgeZones(@PathVariable UUID regionId) {
    return ResponseEntity.ok(surgeZoneService.listSurgeZones(regionId));
  }

  /**
   * Draws a surge zone (UC-A-08); the polygon must lie within the region's boundary.
   *
   * @param regionId the region
   * @param request the zone
   * @return 201 with the created zone
   */
  @PostMapping("/regions/{regionId}/surge-zones")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Draw a surge zone")
  public ResponseEntity<SurgeZoneDto> createSurgeZone(
      @PathVariable UUID regionId, @Valid @RequestBody SurgeZoneUpsertRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(surgeZoneService.createSurgeZone(SecurityUtils.currentUserId(), regionId, request));
  }

  /**
   * Edits a surge zone (UC-A-08).
   *
   * @param surgeZoneId the zone
   * @param request the replacement values
   * @return 200 with the updated zone
   */
  @PutMapping("/surge-zones/{surgeZoneId}")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Edit a surge zone")
  public ResponseEntity<SurgeZoneDto> updateSurgeZone(
      @PathVariable UUID surgeZoneId, @Valid @RequestBody SurgeZoneUpsertRequestDto request) {
    return ResponseEntity.ok(
        surgeZoneService.updateSurgeZone(SecurityUtils.currentUserId(), surgeZoneId, request));
  }

  /**
   * Deletes a surge zone (UC-A-08).
   *
   * @param surgeZoneId the zone
   * @return 204
   */
  @DeleteMapping("/surge-zones/{surgeZoneId}")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Delete a surge zone")
  public ResponseEntity<Void> deleteSurgeZone(@PathVariable UUID surgeZoneId) {
    surgeZoneService.deleteSurgeZone(SecurityUtils.currentUserId(), surgeZoneId);
    return ResponseEntity.noContent().build();
  }
}
