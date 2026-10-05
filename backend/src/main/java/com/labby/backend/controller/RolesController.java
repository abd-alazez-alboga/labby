package com.labby.backend.controller;

import com.labby.backend.dto.CreateRoleRequestDto;
import com.labby.backend.dto.PermissionDto;
import com.labby.backend.dto.RoleDto;
import com.labby.backend.dto.UpdateRoleRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.RbacRoleService;
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
 * Role and permission-catalog endpoints per the M3 contract (backend/docs/api/rbac-v1.yaml);
 * permissions enforced server-side (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "Roles", description = "Role builder and permission catalog")
@RequiredArgsConstructor
public class RolesController {

  private final RbacRoleService rbacRoleService;

  /**
   * Lists roles with their permission sets.
   *
   * @return 200 with all roles
   */
  @GetMapping("/roles")
  @PreAuthorize("hasAuthority('roles:view')")
  @Operation(summary = "List roles with their permission sets")
  public ResponseEntity<List<RoleDto>> listRoles() {
    return ResponseEntity.ok(rbacRoleService.listRoles());
  }

  /**
   * Creates a custom role (UC-A-03).
   *
   * @param request name + permissions
   * @return 201 with the created role
   */
  @PostMapping("/roles")
  @PreAuthorize("hasAuthority('roles:manage')")
  @Operation(summary = "Create a custom role")
  public ResponseEntity<RoleDto> createRole(@Valid @RequestBody CreateRoleRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(rbacRoleService.createRole(SecurityUtils.currentUserId(), request));
  }

  /**
   * Edits a role's name/permissions (UC-A-03); applies instantly to every holder.
   *
   * @param roleId the role
   * @param request new name + permission set
   * @return 200 with the updated role
   */
  @PutMapping("/roles/{roleId}")
  @PreAuthorize("hasAuthority('roles:manage')")
  @Operation(summary = "Edit a role's name/permissions")
  public ResponseEntity<RoleDto> updateRole(
      @PathVariable UUID roleId, @Valid @RequestBody UpdateRoleRequestDto request) {
    return ResponseEntity.ok(
        rbacRoleService.updateRole(SecurityUtils.currentUserId(), roleId, request));
  }

  /**
   * Deletes a custom role (UC-A-03).
   *
   * @param roleId the role
   * @return 204
   */
  @DeleteMapping("/roles/{roleId}")
  @PreAuthorize("hasAuthority('roles:manage')")
  @Operation(summary = "Delete a custom role")
  public ResponseEntity<Void> deleteRole(@PathVariable UUID roleId) {
    rbacRoleService.deleteRole(SecurityUtils.currentUserId(), roleId);
    return ResponseEntity.noContent().build();
  }

  /**
   * Returns the permission catalog for the role-builder checklist.
   *
   * @return 200 with the catalog in stable order
   */
  @GetMapping("/permissions")
  @PreAuthorize("hasAuthority('roles:view')")
  @Operation(summary = "The permission catalog for the role builder")
  public ResponseEntity<List<PermissionDto>> listPermissions() {
    return ResponseEntity.ok(rbacRoleService.listPermissions());
  }
}
