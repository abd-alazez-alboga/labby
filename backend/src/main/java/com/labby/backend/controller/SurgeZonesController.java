package com.labby.backend.controller;

import com.labby.backend.dto.SurgeOverrideRequestDto;
import com.labby.backend.dto.SurgeStateDto;
import com.labby.backend.dto.SurgeZoneDto;
import com.labby.backend.dto.SurgeZoneUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SurgeService;
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
 * Admin surge-zone endpoints per backend/docs/api/regions-v1.yaml: zone config (M4), the UC-A-09
 * manual override and the live surge state (M9); pricing-flavored, so gated by {@code pricing:*}
 * (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "SurgeZones", description = "Per-region surge zones (PRC-02)")
@RequiredArgsConstructor
public class SurgeZonesController {

  private final SurgeZoneService surgeZoneService;
  private final SurgeService surgeService;

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

  /**
   * Sets a zone's manual multiplier (UC-A-09); effective at the next surge cycle.
   *
   * @param surgeZoneId the zone
   * @param request the multiplier (1.00 .. the zone's effective cap)
   * @return 200 with the zone
   */
  @PutMapping("/surge-zones/{surgeZoneId}/override")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Override a zone's surge multiplier (UC-A-09)")
  public ResponseEntity<SurgeZoneDto> setOverride(
      @PathVariable UUID surgeZoneId, @Valid @RequestBody SurgeOverrideRequestDto request) {
    return ResponseEntity.ok(
        surgeZoneService.setOverride(SecurityUtils.currentUserId(), surgeZoneId, request));
  }

  /**
   * Resets a zone to automatic (UC-A-09); effective at the next surge cycle.
   *
   * @param surgeZoneId the zone
   * @return 204
   */
  @DeleteMapping("/surge-zones/{surgeZoneId}/override")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Reset a zone's surge to automatic (UC-A-09)")
  public ResponseEntity<Void> resetOverride(@PathVariable UUID surgeZoneId) {
    surgeZoneService.resetOverride(SecurityUtils.currentUserId(), surgeZoneId);
    return ResponseEntity.noContent().build();
  }

  /**
   * A region's live surge state (UC-A-09): multipliers, override state, last cycle's counts.
   *
   * @param regionId the region
   * @return 200 with the state
   */
  @GetMapping("/regions/{regionId}/surge-state")
  @PreAuthorize("hasAuthority('pricing:view')")
  @Operation(summary = "A region's live surge state")
  public ResponseEntity<SurgeStateDto> surgeState(@PathVariable UUID regionId) {
    return ResponseEntity.ok(surgeService.surgeState(regionId));
  }
}
