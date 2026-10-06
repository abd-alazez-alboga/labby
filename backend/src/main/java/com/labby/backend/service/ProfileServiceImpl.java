package com.labby.backend.service;

import com.labby.backend.dto.RoleAssignmentDto;
import com.labby.backend.dto.RoleSummaryDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.Role;
import com.labby.backend.model.RbacPermission;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.util.UserMapper;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Profile assembly with RBAC enrichment of the admin assignment (see {@link ProfileService}). */
@Service
@RequiredArgsConstructor
public class ProfileServiceImpl implements ProfileService {

  private final UserMapper userMapper;
  private final RbacRoleRepository rbacRoleRepository;

  @Override
  @Transactional(readOnly = true)
  public UserProfileDto profileFor(User user, List<RoleAssignment> roles) {
    List<RoleAssignmentDto> dtos = roles.stream().map(this::toDto).toList();
    return userMapper.toProfileDto(user, dtos);
  }

  private RoleAssignmentDto toDto(RoleAssignment assignment) {
    RoleAssignmentDto base = userMapper.toRoleAssignmentDto(assignment);
    if (assignment.getRole() != Role.ADMIN || assignment.getAdminRoleId() == null) {
      return base;
    }
    return rbacRoleRepository
        .findWithPermissionsById(assignment.getAdminRoleId())
        .map(
            rbacRole ->
                new RoleAssignmentDto(
                    base.role(),
                    base.state(),
                    base.suspensionReason(),
                    new RoleSummaryDto(rbacRole.getId(), rbacRole.getName()),
                    rbacRole.getPermissions().stream()
                        .map(RbacPermission::getCode)
                        .sorted()
                        .toList()))
        .orElse(base);
  }
}
