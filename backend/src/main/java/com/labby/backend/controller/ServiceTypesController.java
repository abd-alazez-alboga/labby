package com.labby.backend.controller;

import com.labby.backend.dto.ServiceTypeDto;
import com.labby.backend.dto.ServiceTypeUpsertRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ServiceTypeService;
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
 * Admin service-type endpoints per the M4 contract (backend/docs/api/regions-v1.yaml);
 * pricing-flavored, so gated by {@code pricing:*} (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "ServiceTypes", description = "Per-region service types and pricing (PRC-01)")
@RequiredArgsConstructor
public class ServiceTypesController {

  private final ServiceTypeService serviceTypeService;

  /**
   * Lists a region's service types, enabled and disabled.
   *
   * @param regionId the region
   * @return 200 with the types
   */
  @GetMapping("/regions/{regionId}/service-types")
  @PreAuthorize("hasAuthority('pricing:view')")
  @Operation(summary = "List a region's service types")
  public ResponseEntity<List<ServiceTypeDto>> listServiceTypes(@PathVariable UUID regionId) {
    return ResponseEntity.ok(serviceTypeService.listServiceTypes(regionId));
  }

  /**
   * Adds a service type with its pricing (UC-A-07).
   *
   * @param regionId the region
   * @param request the type with its pricing
   * @return 201 with the created type
   */
  @PostMapping("/regions/{regionId}/service-types")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Add a service type with its pricing")
  public ResponseEntity<ServiceTypeDto> createServiceType(
      @PathVariable UUID regionId, @Valid @RequestBody ServiceTypeUpsertRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            serviceTypeService.createServiceType(SecurityUtils.currentUserId(), regionId, request));
  }

  /**
   * Edits or disables a service type (UC-A-07); types are never deleted.
   *
   * @param serviceTypeId the type
   * @param request the replacement values
   * @return 200 with the updated type
   */
  @PutMapping("/service-types/{serviceTypeId}")
  @PreAuthorize("hasAuthority('pricing:edit')")
  @Operation(summary = "Edit or disable a service type")
  public ResponseEntity<ServiceTypeDto> updateServiceType(
      @PathVariable UUID serviceTypeId, @Valid @RequestBody ServiceTypeUpsertRequestDto request) {
    return ResponseEntity.ok(
        serviceTypeService.updateServiceType(
            SecurityUtils.currentUserId(), serviceTypeId, request));
  }
}
