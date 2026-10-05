package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.labby.backend.dto.RoleAssignmentDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.Role;
import com.labby.backend.model.RbacPermission;
import com.labby.backend.model.RbacRole;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.service.ProfileServiceImpl;
import com.labby.backend.util.RbacIds;
import com.labby.backend.util.UserMapper;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Admin assignments carry rbacRole + permissions for UI gating; others stay bare (RBAC-03). */
@ExtendWith(MockitoExtension.class)
class ProfileServiceImplTest {

  @Mock private RbacRoleRepository rbacRoleRepository;

  private final UserMapper userMapper = Mappers.getMapper(UserMapper.class);

  private ProfileServiceImpl service() {
    return new ProfileServiceImpl(userMapper, rbacRoleRepository);
  }

  private static User user() {
    User user = User.builder().phone("+963900000009").passwordHash("x").name("U").build();
    user.setId(UUID.randomUUID());
    return user;
  }

  @Test
  @DisplayName("the admin assignment is enriched with its RBAC role and sorted permission codes")
  void shouldEnrichAdminAssignment() {
    User user = user();
    RoleAssignment rider = RoleAssignment.builder().userId(user.getId()).role(Role.RIDER).build();
    RoleAssignment admin =
        RoleAssignment.builder()
            .userId(user.getId())
            .role(Role.ADMIN)
            .adminRoleId(RbacIds.SUPPORT_ROLE_ID)
            .build();
    RbacRole support = RbacRole.builder().name("Support").system(true).build();
    support.setId(RbacIds.SUPPORT_ROLE_ID);
    Set<RbacPermission> grants = new HashSet<>();
    for (String code : List.of("users:view", "rides:view")) {
      RbacPermission permission =
          RbacPermission.builder().code(code).domain(code.split(":")[0]).build();
      permission.setId(UUID.randomUUID());
      grants.add(permission);
    }
    support.setPermissions(grants);
    when(rbacRoleRepository.findWithPermissionsById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(support));

    UserProfileDto profile = service().profileFor(user, List.of(rider, admin));

    RoleAssignmentDto riderDto =
        profile.roles().stream().filter(r -> r.role() == Role.RIDER).findFirst().orElseThrow();
    RoleAssignmentDto adminDto =
        profile.roles().stream().filter(r -> r.role() == Role.ADMIN).findFirst().orElseThrow();
    assertThat(riderDto.rbacRole()).isNull();
    assertThat(riderDto.permissions()).isNull();
    assertThat(adminDto.rbacRole().name()).isEqualTo("Support");
    assertThat(adminDto.permissions()).containsExactly("rides:view", "users:view");
  }

  @Test
  @DisplayName("a missing RBAC role degrades to the bare assignment instead of failing")
  void shouldDegradeWhenRoleRowMissing() {
    User user = user();
    RoleAssignment admin =
        RoleAssignment.builder()
            .userId(user.getId())
            .role(Role.ADMIN)
            .adminRoleId(UUID.randomUUID())
            .build();
    when(rbacRoleRepository.findWithPermissionsById(admin.getAdminRoleId()))
        .thenReturn(Optional.empty());

    UserProfileDto profile = service().profileFor(user, List.of(admin));

    assertThat(profile.roles().get(0).rbacRole()).isNull();
    assertThat(profile.roles().get(0).permissions()).isNull();
  }
}
