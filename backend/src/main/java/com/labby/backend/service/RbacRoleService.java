package com.labby.backend.service;

import com.labby.backend.dto.CreateRoleRequestDto;
import com.labby.backend.dto.PermissionDto;
import com.labby.backend.dto.RoleDto;
import com.labby.backend.dto.UpdateRoleRequestDto;
import java.util.List;
import java.util.UUID;

/** Role and permission-catalog management (UC-A-03, RBAC-01/02/04). */
public interface RbacRoleService {

  /** Lists all roles with their permission sets and assigned-admin counts. */
  List<RoleDto> listRoles();

  /** Returns the permission catalog for the role-builder checklist. */
  List<PermissionDto> listPermissions();

  /**
   * Creates a custom role.
   *
   * @param actorUserId the acting admin (audited)
   * @param request name + ticked permissions
   * @return the created role
   */
  RoleDto createRole(UUID actorUserId, CreateRoleRequestDto request);

  /**
   * Edits a role's name/permissions; instantly affects every holder (RBAC-02). Super Admin is
   * immutable and system roles cannot be renamed.
   *
   * @param actorUserId the acting admin (audited)
   * @param roleId the role
   * @param request new name + permission set
   * @return the updated role
   */
  RoleDto updateRole(UUID actorUserId, UUID roleId, UpdateRoleRequestDto request);

  /**
   * Deletes a custom role. System roles and roles still assigned to admins are blocked.
   *
   * @param actorUserId the acting admin (audited)
   * @param roleId the role
   */
  void deleteRole(UUID actorUserId, UUID roleId);
}
