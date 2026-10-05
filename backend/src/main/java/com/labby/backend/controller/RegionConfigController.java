package com.labby.backend.controller;

import com.labby.backend.dto.RegionConfigDto;
import com.labby.backend.service.RegionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Client region endpoints per the M4 contract (backend/docs/api/regions-v1.yaml, SD-01): any
 * authenticated account, no admin role — like {@code /users/me}, the deny-by-default security chain
 * authenticates these without a {@code @PreAuthorize} permission gate.
 */
@RestController
@RequestMapping("/api/v1/regions")
@Tag(name = "Client", description = "Region resolution and client config (SD-01)")
@RequiredArgsConstructor
public class RegionConfigController {

  private final RegionService regionService;

  /**
   * Resolves the ACTIVE region covering a GPS point; no covering region → 404 (the apps render the
   * outside-operating-area state).
   *
   * @param lat latitude in [-90, 90]
   * @param lng longitude in [-180, 180]
   * @return 200 with the covering region's client config
   */
  @GetMapping("/resolve")
  @Operation(summary = "Resolve the region covering a GPS point")
  public ResponseEntity<RegionConfigDto> resolveRegion(
      @RequestParam double lat, @RequestParam double lng) {
    return ResponseEntity.ok(regionService.resolveRegion(lat, lng));
  }

  /**
   * Reads a region's client config: currency, emergency number and ENABLED service types. Draft
   * regions are not served.
   *
   * @param regionId the region
   * @return 200 with the client config
   */
  @GetMapping("/{regionId}/config")
  @Operation(summary = "Read a region's client config")
  public ResponseEntity<RegionConfigDto> getRegionConfig(@PathVariable UUID regionId) {
    return ResponseEntity.ok(regionService.getRegionConfig(regionId));
  }
}
