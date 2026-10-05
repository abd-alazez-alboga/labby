package com.labby.backend.service;

import com.labby.backend.dto.AdminAccountDto;
import com.labby.backend.dto.ChangeAdminRoleRequestDto;
import com.labby.backend.dto.CreateAdminRequestDto;
import com.labby.backend.dto.CreateAdminResponseDto;
import com.labby.backend.dto.RoleSummaryDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.AdminCreationMode;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.RoleState;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.RbacRole;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.util.RbacIds;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Admin account lifecycle per UC-A-01/02. Admin accounts are never self-registered (AUTH-06); every
 * mutation here is audited (RBAC-05). Deactivation suspends the admin ROLE assignment, so
 * permission resolution (per request) cuts access instantly while other roles keep working.
 */
@Service
@RequiredArgsConstructor
public class AdminAccountServiceImpl implements AdminAccountService {

  private static final String TARGET_TYPE_ADMIN = "admin";

  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RbacRoleRepository rbacRoleRepository;
  private final AuditService auditService;
  private final OtpService otpService;
  private final PasswordEncoder passwordEncoder;

  @Override
  @Transactional(readOnly = true)
  public List<AdminAccountDto> listAdmins() {
    List<RoleAssignment> assignments =
        roleAssignmentRepository.findByRoleOrderByGrantedAtAsc(Role.ADMIN);
    Map<UUID, User> users =
        userRepository
            .findAllById(assignments.stream().map(RoleAssignment::getUserId).toList())
            .stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
    Map<UUID, RbacRole> roles =
        rbacRoleRepository
            .findAllById(assignments.stream().map(RoleAssignment::getAdminRoleId).toList())
            .stream()
            .collect(Collectors.toMap(RbacRole::getId, Function.identity()));
    return assignments.stream()
        .map(
            assignment ->
                toDto(
                    users.get(assignment.getUserId()),
                    assignment,
                    roles.get(assignment.getAdminRoleId())))
        .toList();
  }

  @Override
  @Transactional
  public CreateAdminResponseDto createAdmin(UUID actorUserId, CreateAdminRequestDto request) {
    RbacRole role =
        rbacRoleRepository
            .findById(request.roleId())
            .orElseThrow(() -> new InvalidRequestException("Unknown role"));
    requireSuperAdminActorForSuperAdminGrant(actorUserId, role.getId());
    Optional<User> existing = userRepository.findByPhone(request.phone());
    if (existing.isEmpty()) {
      return createFreshAdmin(actorUserId, request, role);
    }
    User user = existing.get();
    if (user.getState() == AccountState.DELETED) {
      throw new ConflictException(
          "The phone belongs to a deleted account; it must be reactivated first");
    }
    if (roleAssignmentRepository.existsByUserIdAndRole(user.getId(), Role.ADMIN)) {
      throw new ResourceAlreadyExistsException("Admin", "phone", request.phone());
    }
    RoleAssignment assignment = grantAdminRole(user.getId(), role.getId());
    auditService.record(
        actorUserId,
        "admin.create",
        TARGET_TYPE_ADMIN,
        user.getId().toString(),
        null,
        Map.of("mode", "granted_existing", "phone", user.getPhone(), "role", role.getName()));
    return new CreateAdminResponseDto(
        AdminCreationMode.GRANTED_EXISTING, toDto(user, assignment, role));
  }

  @Override
  @Transactional
  public AdminAccountDto changeRole(
      UUID actorUserId, UUID userId, ChangeAdminRoleRequestDto request) {
    RoleAssignment assignment = requireAdminAssignment(userId);
    RbacRole newRole =
        rbacRoleRepository
            .findById(request.roleId())
            .orElseThrow(() -> new InvalidRequestException("Unknown role"));
    RbacRole oldRole = rbacRoleRepository.findById(assignment.getAdminRoleId()).orElse(null);
    if (!newRole.getId().equals(assignment.getAdminRoleId())) {
      requireSuperAdminActorForSuperAdminGrant(actorUserId, newRole.getId());
      requireNotLastActiveSuperAdmin(
          assignment, "The last active Super Admin cannot lose the role");
      Map<String, Object> before = stateSnapshot(assignment, oldRole);
      assignment.setAdminRoleId(newRole.getId());
      roleAssignmentRepository.save(assignment);
      auditService.record(
          actorUserId,
          "admin.role_change",
          TARGET_TYPE_ADMIN,
          userId.toString(),
          before,
          stateSnapshot(assignment, newRole));
    }
    return toDto(requireUser(userId), assignment, newRole);
  }

  @Override
  @Transactional
  public AdminAccountDto deactivate(UUID actorUserId, UUID userId) {
    RoleAssignment assignment = requireAdminAssignment(userId);
    RbacRole role = rbacRoleRepository.findById(assignment.getAdminRoleId()).orElse(null);
    if (assignment.getState() == RoleState.ACTIVE) {
      requireNotLastActiveSuperAdmin(
          assignment, "The last active Super Admin cannot be deactivated");
      Map<String, Object> before = stateSnapshot(assignment, role);
      assignment.setState(RoleState.SUSPENDED);
      roleAssignmentRepository.save(assignment);
      auditService.record(
          actorUserId,
          "admin.deactivate",
          TARGET_TYPE_ADMIN,
          userId.toString(),
          before,
          stateSnapshot(assignment, role));
    }
    return toDto(requireUser(userId), assignment, role);
  }

  @Override
  @Transactional
  public AdminAccountDto reactivate(UUID actorUserId, UUID userId) {
    RoleAssignment assignment = requireAdminAssignment(userId);
    RbacRole role = rbacRoleRepository.findById(assignment.getAdminRoleId()).orElse(null);
    if (assignment.getState() == RoleState.SUSPENDED) {
      Map<String, Object> before = stateSnapshot(assignment, role);
      assignment.setState(RoleState.ACTIVE);
      roleAssignmentRepository.save(assignment);
      auditService.record(
          actorUserId,
          "admin.reactivate",
          TARGET_TYPE_ADMIN,
          userId.toString(),
          before,
          stateSnapshot(assignment, role));
    }
    return toDto(requireUser(userId), assignment, role);
  }

  private CreateAdminResponseDto createFreshAdmin(
      UUID actorUserId, CreateAdminRequestDto request, RbacRole role) {
    User user =
        userRepository.save(
            User.builder()
                .phone(request.phone())
                // Unusable until the set-password flow completes: random secret, never disclosed.
                .passwordHash(passwordEncoder.encode(UUID.randomUUID().toString()))
                .name(request.name())
                .language(Language.EN)
                .state(AccountState.ACTIVE)
                .createdBy(actorUserId)
                .updatedBy(actorUserId)
                .build());
    RoleAssignment assignment = grantAdminRole(user.getId(), role.getId());
    // Set-password path (AUTH-06): purpose `reset` so the admin completes via the existing
    // password-reset endpoints. AUTH-04 limits and SMS failures roll the creation back whole.
    otpService.issue(user.getPhone(), OtpPurpose.RESET, user.getLanguage());
    auditService.record(
        actorUserId,
        "admin.create",
        TARGET_TYPE_ADMIN,
        user.getId().toString(),
        null,
        Map.of("mode", "created", "phone", user.getPhone(), "role", role.getName()));
    return new CreateAdminResponseDto(AdminCreationMode.CREATED, toDto(user, assignment, role));
  }

  private RoleAssignment grantAdminRole(UUID userId, UUID roleId) {
    return roleAssignmentRepository.save(
        RoleAssignment.builder().userId(userId).role(Role.ADMIN).adminRoleId(roleId).build());
  }

  private RoleAssignment requireAdminAssignment(UUID userId) {
    return roleAssignmentRepository
        .findByUserIdAndRole(userId, Role.ADMIN)
        .orElseThrow(() -> new ResourceNotFoundException("Admin account", userId));
  }

  private User requireUser(UUID userId) {
    return userRepository
        .findById(userId)
        .orElseThrow(() -> new ResourceNotFoundException("User", userId));
  }

  // Escalation guard (review-M03 W2): admins:manage alone must not reach full access, so
  // granting the Super Admin role requires an active Super Admin actor.
  private void requireSuperAdminActorForSuperAdminGrant(UUID actorUserId, UUID grantedRoleId) {
    if (!RbacIds.SUPER_ADMIN_ROLE_ID.equals(grantedRoleId)) {
      return;
    }
    boolean actorIsActiveSuperAdmin =
        roleAssignmentRepository
            .findByUserIdAndRole(actorUserId, Role.ADMIN)
            .map(
                actor ->
                    RbacIds.SUPER_ADMIN_ROLE_ID.equals(actor.getAdminRoleId())
                        && actor.getState() == RoleState.ACTIVE)
            .orElse(false);
    if (!actorIsActiveSuperAdmin) {
      throw new ConflictException("Only a Super Admin can assign the Super Admin role");
    }
  }

  private void requireNotLastActiveSuperAdmin(RoleAssignment assignment, String message) {
    boolean activeSuperAdmin =
        RbacIds.SUPER_ADMIN_ROLE_ID.equals(assignment.getAdminRoleId())
            && assignment.getState() == RoleState.ACTIVE;
    if (activeSuperAdmin
        && roleAssignmentRepository.countByRoleAndAdminRoleIdAndState(
                Role.ADMIN, RbacIds.SUPER_ADMIN_ROLE_ID, RoleState.ACTIVE)
            <= 1) {
      throw new ConflictException(message);
    }
  }

  private Map<String, Object> stateSnapshot(RoleAssignment assignment, RbacRole role) {
    return Map.of(
        "role",
        role == null ? assignment.getAdminRoleId().toString() : role.getName(),
        "state",
        assignment.getState().getValue());
  }

  private AdminAccountDto toDto(User user, RoleAssignment assignment, RbacRole role) {
    return new AdminAccountDto(
        user.getId(),
        user.getPhone(),
        user.getName(),
        assignment.getState(),
        role == null ? null : new RoleSummaryDto(role.getId(), role.getName()),
        assignment.getGrantedAt().atOffset(ZoneOffset.UTC));
  }
}
