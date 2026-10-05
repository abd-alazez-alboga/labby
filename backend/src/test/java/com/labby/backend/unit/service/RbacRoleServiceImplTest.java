package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.dto.CreateRoleRequestDto;
import com.labby.backend.dto.RoleDto;
import com.labby.backend.dto.UpdateRoleRequestDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.RbacPermission;
import com.labby.backend.model.RbacRole;
import com.labby.backend.repository.RbacPermissionRepository;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.service.AuditService;
import com.labby.backend.service.RbacRoleServiceImpl;
import com.labby.backend.util.RbacIds;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** UC-A-03 rules: system roles protected, Super Admin immutable, assigned roles undeletable. */
@ExtendWith(MockitoExtension.class)
class RbacRoleServiceImplTest {

  private static final UUID ACTOR = UUID.randomUUID();

  @Mock private RbacRoleRepository rbacRoleRepository;
  @Mock private RbacPermissionRepository rbacPermissionRepository;
  @Mock private RoleAssignmentRepository roleAssignmentRepository;
  @Mock private AuditService auditService;

  private RbacRoleServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new RbacRoleServiceImpl(
            rbacRoleRepository, rbacPermissionRepository, roleAssignmentRepository, auditService);
  }

  private static RbacPermission permission(String code) {
    RbacPermission entity = RbacPermission.builder().code(code).domain(code.split(":")[0]).build();
    entity.setId(UUID.randomUUID());
    return entity;
  }

  private static RbacRole role(UUID id, String name, boolean system) {
    RbacRole role = RbacRole.builder().name(name).system(system).build();
    role.setId(id);
    role.setPermissions(new HashSet<>());
    return role;
  }

  @Test
  @DisplayName("createRole rejects a duplicate name")
  void shouldRejectCreateWhenNameExists() {
    when(rbacRoleRepository.existsByNameIgnoreCase("Ops")).thenReturn(true);

    assertThatThrownBy(
            () ->
                service.createRole(
                    ACTOR, new CreateRoleRequestDto("Ops", List.of(Permission.USERS_VIEW))))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("createRole saves the ticked permissions and audits")
  void shouldCreateRoleAndAudit() {
    when(rbacRoleRepository.existsByNameIgnoreCase("Ops")).thenReturn(false);
    when(rbacPermissionRepository.findByCodeIn(List.of("users:view", "rides:view")))
        .thenReturn(List.of(permission("users:view"), permission("rides:view")));
    when(rbacRoleRepository.save(any()))
        .thenAnswer(
            invocation -> {
              RbacRole saved = invocation.getArgument(0);
              saved.setId(UUID.randomUUID());
              return saved;
            });
    when(roleAssignmentRepository.countByAdminRoleId(any())).thenReturn(0L);

    RoleDto dto =
        service.createRole(
            ACTOR,
            new CreateRoleRequestDto("Ops", List.of(Permission.USERS_VIEW, Permission.RIDES_VIEW)));

    assertThat(dto.name()).isEqualTo("Ops");
    assertThat(dto.permissions()).containsExactly("rides:view", "users:view");
    assertThat(dto.isSystem()).isFalse();
    verify(auditService)
        .record(eq(ACTOR), eq("role.create"), eq("role"), eq(dto.id().toString()), isNull(), any());
  }

  @Test
  @DisplayName("updateRole refuses the Super Admin role entirely")
  void shouldRejectUpdateOfSuperAdmin() {
    when(rbacRoleRepository.findWithPermissionsById(RbacIds.SUPER_ADMIN_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPER_ADMIN_ROLE_ID, "Super Admin", true)));

    assertThatThrownBy(
            () ->
                service.updateRole(
                    ACTOR,
                    RbacIds.SUPER_ADMIN_ROLE_ID,
                    new UpdateRoleRequestDto("Super Admin", List.of())))
        .isInstanceOf(ConflictException.class);
  }

  @Test
  @DisplayName("updateRole refuses renaming a system role but allows editing its permissions")
  void shouldRejectSystemRenameButAllowPermissionEdit() {
    RbacRole support = role(RbacIds.SUPPORT_ROLE_ID, "Support", true);
    when(rbacRoleRepository.findWithPermissionsById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(support));

    assertThatThrownBy(
            () ->
                service.updateRole(
                    ACTOR,
                    RbacIds.SUPPORT_ROLE_ID,
                    new UpdateRoleRequestDto("Helpdesk", List.of())))
        .isInstanceOf(ConflictException.class);

    when(rbacPermissionRepository.findByCodeIn(List.of("users:view")))
        .thenReturn(List.of(permission("users:view")));
    when(rbacRoleRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    when(roleAssignmentRepository.countByAdminRoleId(any())).thenReturn(1L);

    RoleDto dto =
        service.updateRole(
            ACTOR,
            RbacIds.SUPPORT_ROLE_ID,
            new UpdateRoleRequestDto("Support", List.of(Permission.USERS_VIEW)));

    assertThat(dto.permissions()).containsExactly("users:view");
    verify(auditService).record(eq(ACTOR), eq("role.update"), eq("role"), any(), any(), any());
  }

  @Test
  @DisplayName("updateRole rejects renaming to an existing name")
  void shouldRejectUpdateWhenNewNameExists() {
    UUID roleId = UUID.randomUUID();
    when(rbacRoleRepository.findWithPermissionsById(roleId))
        .thenReturn(Optional.of(role(roleId, "Ops", false)));
    when(rbacRoleRepository.existsByNameIgnoreCase("Support")).thenReturn(true);

    assertThatThrownBy(
            () -> service.updateRole(ACTOR, roleId, new UpdateRoleRequestDto("Support", List.of())))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("deleteRole refuses system roles and assigned roles, deletes a free custom role")
  void shouldEnforceDeleteRules() {
    when(rbacRoleRepository.findWithPermissionsById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPPORT_ROLE_ID, "Support", true)));
    assertThatThrownBy(() -> service.deleteRole(ACTOR, RbacIds.SUPPORT_ROLE_ID))
        .isInstanceOf(ConflictException.class);

    UUID assignedId = UUID.randomUUID();
    when(rbacRoleRepository.findWithPermissionsById(assignedId))
        .thenReturn(Optional.of(role(assignedId, "Ops", false)));
    when(roleAssignmentRepository.existsByAdminRoleId(assignedId)).thenReturn(true);
    assertThatThrownBy(() -> service.deleteRole(ACTOR, assignedId))
        .isInstanceOf(ConflictException.class);
    verify(rbacRoleRepository, never()).delete(any());

    UUID freeId = UUID.randomUUID();
    RbacRole free = role(freeId, "Free", false);
    when(rbacRoleRepository.findWithPermissionsById(freeId)).thenReturn(Optional.of(free));
    when(roleAssignmentRepository.existsByAdminRoleId(freeId)).thenReturn(false);

    service.deleteRole(ACTOR, freeId);

    verify(rbacRoleRepository).delete(free);
    verify(auditService)
        .record(eq(ACTOR), eq("role.delete"), eq("role"), eq(freeId.toString()), any(), isNull());
  }

  @Test
  @DisplayName("updateRole 404s on an unknown role")
  void shouldFailUpdateWhenRoleMissing() {
    UUID missing = UUID.randomUUID();
    when(rbacRoleRepository.findWithPermissionsById(missing)).thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> service.updateRole(ACTOR, missing, new UpdateRoleRequestDto("X", List.of())))
        .isInstanceOf(ResourceNotFoundException.class);
  }

  @Test
  @DisplayName("a drifted catalog fails loudly instead of silently dropping permissions")
  void shouldFailWhenCatalogOutOfSync() {
    when(rbacRoleRepository.existsByNameIgnoreCase("Ops")).thenReturn(false);
    when(rbacPermissionRepository.findByCodeIn(anyList())).thenReturn(List.of());

    assertThatThrownBy(
            () ->
                service.createRole(
                    ACTOR, new CreateRoleRequestDto("Ops", List.of(Permission.USERS_VIEW))))
        .isInstanceOf(IllegalStateException.class);
  }
}
