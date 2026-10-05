package com.labby.backend.service;

import com.labby.backend.dto.CreateRoleRequestDto;
import com.labby.backend.dto.PermissionDto;
import com.labby.backend.dto.RoleDto;
import com.labby.backend.dto.UpdateRoleRequestDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.RbacPermission;
import com.labby.backend.model.RbacRole;
import com.labby.backend.repository.RbacPermissionRepository;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.util.RbacIds;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Role CRUD with the RBAC-01/02 invariants; every mutation is audited (RBAC-05). */
@Service
@RequiredArgsConstructor
public class RbacRoleServiceImpl implements RbacRoleService {

  private static final String TARGET_TYPE_ROLE = "role";

  private final RbacRoleRepository rbacRoleRepository;
  private final RbacPermissionRepository rbacPermissionRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final AuditService auditService;

  @Override
  @Transactional(readOnly = true)
  public List<RoleDto> listRoles() {
    return rbacRoleRepository.findAllByOrderByNameAsc().stream().map(this::toDto).toList();
  }

  @Override
  @Transactional(readOnly = true)
  public List<PermissionDto> listPermissions() {
    return rbacPermissionRepository.findAllByOrderByCodeAsc().stream()
        .map(permission -> new PermissionDto(permission.getCode(), permission.getDomain()))
        .toList();
  }

  @Override
  @Transactional
  public RoleDto createRole(UUID actorUserId, CreateRoleRequestDto request) {
    if (rbacRoleRepository.existsByNameIgnoreCase(request.name())) {
      throw new ResourceAlreadyExistsException("Role", "name", request.name());
    }
    RbacRole role =
        RbacRole.builder()
            .name(request.name())
            .system(false)
            .permissions(new HashSet<>(resolvePermissions(request.permissions())))
            .createdBy(actorUserId)
            .updatedBy(actorUserId)
            .build();
    RbacRole saved = rbacRoleRepository.save(role);
    auditService.record(
        actorUserId,
        "role.create",
        TARGET_TYPE_ROLE,
        saved.getId().toString(),
        null,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public RoleDto updateRole(UUID actorUserId, UUID roleId, UpdateRoleRequestDto request) {
    RbacRole role =
        rbacRoleRepository
            .findWithPermissionsById(roleId)
            .orElseThrow(() -> new ResourceNotFoundException("Role", roleId));
    if (RbacIds.SUPER_ADMIN_ROLE_ID.equals(role.getId())) {
      throw new BusinessRuleViolationException("The Super Admin role is immutable");
    }
    boolean renamed = !role.getName().equals(request.name());
    if (renamed && role.isSystem()) {
      throw new BusinessRuleViolationException("System roles cannot be renamed");
    }
    if (renamed && rbacRoleRepository.existsByNameIgnoreCase(request.name())) {
      throw new ResourceAlreadyExistsException("Role", "name", request.name());
    }
    Map<String, Object> before = snapshot(role);
    role.setName(request.name());
    role.getPermissions().clear();
    role.getPermissions().addAll(resolvePermissions(request.permissions()));
    role.setUpdatedBy(actorUserId);
    RbacRole saved = rbacRoleRepository.save(role);
    auditService.record(
        actorUserId,
        "role.update",
        TARGET_TYPE_ROLE,
        saved.getId().toString(),
        before,
        snapshot(saved));
    return toDto(saved);
  }

  @Override
  @Transactional
  public void deleteRole(UUID actorUserId, UUID roleId) {
    RbacRole role =
        rbacRoleRepository
            .findWithPermissionsById(roleId)
            .orElseThrow(() -> new ResourceNotFoundException("Role", roleId));
    if (role.isSystem()) {
      throw new BusinessRuleViolationException("System roles cannot be deleted");
    }
    if (roleAssignmentRepository.existsByAdminRoleId(roleId)) {
      throw new BusinessRuleViolationException(
          "The role is still assigned to admins; reassign them first");
    }
    Map<String, Object> before = snapshot(role);
    role.getPermissions().clear();
    rbacRoleRepository.delete(role);
    auditService.record(
        actorUserId, "role.delete", TARGET_TYPE_ROLE, roleId.toString(), before, null);
  }

  private List<RbacPermission> resolvePermissions(List<Permission> permissions) {
    List<String> codes = permissions.stream().map(Permission::getValue).distinct().toList();
    List<RbacPermission> resolved = rbacPermissionRepository.findByCodeIn(codes);
    if (resolved.size() != codes.size()) {
      // Unreachable while the seeder keeps code and DB in sync; fail loudly if they drift.
      throw new IllegalStateException("Permission catalog is out of sync with the code catalog");
    }
    return resolved;
  }

  private RoleDto toDto(RbacRole role) {
    return new RoleDto(
        role.getId(),
        role.getName(),
        role.isSystem(),
        role.getPermissions().stream().map(RbacPermission::getCode).sorted().toList(),
        roleAssignmentRepository.countByAdminRoleId(role.getId()));
  }

  private Map<String, Object> snapshot(RbacRole role) {
    return Map.of(
        "name",
        role.getName(),
        "isSystem",
        role.isSystem(),
        "permissions",
        role.getPermissions().stream().map(RbacPermission::getCode).sorted().toList());
  }
}
