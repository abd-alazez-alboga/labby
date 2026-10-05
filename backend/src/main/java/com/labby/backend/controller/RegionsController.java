package com.labby.backend.controller;

import com.labby.backend.dto.RegionDto;
import com.labby.backend.dto.RegionSummaryDto;
import com.labby.backend.dto.RegionUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.RegionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin region-bundle endpoints per the M4 contract (backend/docs/api/regions-v1.yaml); permissions
 * enforced server-side (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin/regions")
@Tag(name = "Regions", description = "Region config bundles (ADM-01)")
@RequiredArgsConstructor
public class RegionsController {

  private final RegionService regionService;

  /**
   * Lists regions, name-sorted.
   *
   * @return 200 with all regions
   */
  @GetMapping
  @PreAuthorize("hasAuthority('regions:view')")
  @Operation(summary = "List regions")
  public ResponseEntity<List<RegionSummaryDto>> listRegions() {
    return ResponseEntity.ok(regionService.listRegions());
  }

  /**
   * Creates a draft region (UC-A-05) — only the name is mandatory.
   *
   * @param request the bundle
   * @return 201 with the draft
   */
  @PostMapping
  @PreAuthorize("hasAuthority('regions:edit')")
  @Operation(summary = "Create a region (draft)")
  public ResponseEntity<RegionDto> createRegion(
      @Valid @RequestBody RegionUpsertRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(regionService.createRegion(SecurityUtils.currentUserId(), request));
  }

  /**
   * Reads a region's full config bundle.
   *
   * @param regionId the region
   * @return 200 with the bundle
   */
  @GetMapping("/{regionId}")
  @PreAuthorize("hasAuthority('regions:view')")
  @Operation(summary = "Read a region's full config bundle")
  public ResponseEntity<RegionDto> getRegion(@PathVariable UUID regionId) {
    return ResponseEntity.ok(regionService.getRegion(regionId));
  }

  /**
   * Replaces a region's bundle (UC-A-06); applies to NEW rides only.
   *
   * @param regionId the region
   * @param request the replacement bundle
   * @return 200 with the updated region
   */
  @PutMapping("/{regionId}")
  @PreAuthorize("hasAuthority('regions:edit')")
  @Operation(summary = "Edit a region's bundle")
  public ResponseEntity<RegionDto> updateRegion(
      @PathVariable UUID regionId, @Valid @RequestBody RegionUpsertRequestDto request) {
    return ResponseEntity.ok(
        regionService.updateRegion(SecurityUtils.currentUserId(), regionId, request));
  }

  /**
   * Activates a region (UC-A-05 step 5); 409 lists any missing mandatory parts.
   *
   * @param regionId the region
   * @return 200 with the active region
   */
  @PostMapping("/{regionId}/activate")
  @PreAuthorize("hasAuthority('regions:edit')")
  @Operation(summary = "Activate a region")
  public ResponseEntity<RegionDto> activateRegion(@PathVariable UUID regionId) {
    return ResponseEntity.ok(regionService.activateRegion(SecurityUtils.currentUserId(), regionId));
  }
}
