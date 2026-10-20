package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.labby.backend.dto.AdminAccountDto;
import com.labby.backend.dto.ChangeAdminRoleRequestDto;
import com.labby.backend.dto.CreateAdminRequestDto;
import com.labby.backend.dto.CreateAdminResponseDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.AdminCreationMode;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.NotificationEvent;
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
import com.labby.backend.service.AdminAccountServiceImpl;
import com.labby.backend.service.AuditService;
import com.labby.backend.service.NotificationService;
import com.labby.backend.service.OtpService;
import com.labby.backend.service.SuperAdminGuard;
import com.labby.backend.util.RbacIds;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

/** UC-A-01/02: creation paths, single-role change, last-Super-Admin protection. */
@ExtendWith(MockitoExtension.class)
class AdminAccountServiceImplTest {

  private static final UUID ACTOR = UUID.randomUUID();
  private static final String PHONE = "+963955500001";

  @Mock private UserRepository userRepository;
  @Mock private RoleAssignmentRepository roleAssignmentRepository;
  @Mock private RbacRoleRepository rbacRoleRepository;
  @Mock private AuditService auditService;
  @Mock private OtpService otpService;
  @Mock private PasswordEncoder passwordEncoder;
  @Mock private NotificationService notificationService;

  private AdminAccountServiceImpl service;

  @BeforeEach
  void setUp() {
    service =
        new AdminAccountServiceImpl(
            userRepository,
            roleAssignmentRepository,
            rbacRoleRepository,
            auditService,
            otpService,
            passwordEncoder,
            new SuperAdminGuard(roleAssignmentRepository),
            notificationService);
  }

  private static RbacRole role(UUID id, String name) {
    RbacRole role = RbacRole.builder().name(name).system(true).build();
    role.setId(id);
    return role;
  }

  private static User user(UUID id, AccountState state) {
    User user =
        User.builder()
            .phone(PHONE)
            .passwordHash("hash")
            .name("Admin")
            .language(Language.EN)
            .state(state)
            .build();
    user.setId(id);
    return user;
  }

  private static RoleAssignment adminAssignment(UUID userId, UUID roleId, RoleState state) {
    RoleAssignment assignment =
        RoleAssignment.builder()
            .userId(userId)
            .role(Role.ADMIN)
            .adminRoleId(roleId)
            .state(state)
            .build();
    assignment.setId(UUID.randomUUID());
    assignment.setGrantedAt(Instant.now());
    return assignment;
  }

  private void stubAssignmentSave() {
    when(roleAssignmentRepository.save(any()))
        .thenAnswer(
            invocation -> {
              RoleAssignment saved = invocation.getArgument(0);
              if (saved.getId() == null) {
                saved.setId(UUID.randomUUID());
              }
              if (saved.getGrantedAt() == null) {
                saved.setGrantedAt(Instant.now());
              }
              return saved;
            });
  }

  @Test
  @DisplayName("createAdmin rejects an unknown role with 400")
  void shouldRejectUnknownRole() {
    when(rbacRoleRepository.findById(any())).thenReturn(Optional.empty());

    assertThatThrownBy(
            () ->
                service.createAdmin(
                    ACTOR, new CreateAdminRequestDto(PHONE, "Admin", UUID.randomUUID())))
        .isInstanceOf(InvalidRequestException.class);
  }

  @Test
  @DisplayName("createAdmin on a new phone creates the account and sends the set-password OTP")
  void shouldCreateFreshAdminWithSetPasswordOtp() {
    RbacRole support = role(RbacIds.SUPPORT_ROLE_ID, "Support");
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID)).thenReturn(Optional.of(support));
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.empty());
    when(passwordEncoder.encode(any())).thenReturn("unusable-hash");
    when(userRepository.save(any()))
        .thenAnswer(
            invocation -> {
              User saved = invocation.getArgument(0);
              saved.setId(UUID.randomUUID());
              return saved;
            });
    stubAssignmentSave();

    CreateAdminResponseDto response =
        service.createAdmin(ACTOR, new CreateAdminRequestDto(PHONE, "Admin", support.getId()));

    assertThat(response.mode()).isEqualTo(AdminCreationMode.CREATED);
    assertThat(response.admin().phone()).isEqualTo(PHONE);
    assertThat(response.admin().role().name()).isEqualTo("Support");
    verify(otpService).issue(PHONE, OtpPurpose.RESET, Language.EN);
    verify(auditService).record(eq(ACTOR), eq("admin.create"), eq("admin"), any(), isNull(), any());
  }

  @Test
  @DisplayName("createAdmin grants the role to an existing account without an OTP (E1)")
  void shouldGrantToExistingAccount() {
    RbacRole support = role(RbacIds.SUPPORT_ROLE_ID, "Support");
    User existing = user(UUID.randomUUID(), AccountState.ACTIVE);
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID)).thenReturn(Optional.of(support));
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(existing));
    when(roleAssignmentRepository.existsByUserIdAndRole(existing.getId(), Role.ADMIN))
        .thenReturn(false);
    stubAssignmentSave();

    CreateAdminResponseDto response =
        service.createAdmin(ACTOR, new CreateAdminRequestDto(PHONE, "Ignored", support.getId()));

    assertThat(response.mode()).isEqualTo(AdminCreationMode.GRANTED_EXISTING);
    assertThat(response.admin().name()).isEqualTo(existing.getName());
    verifyNoInteractions(otpService);
    verify(userRepository, never()).save(any());
  }

  @Test
  @DisplayName("createAdmin rejects a phone that is already an admin")
  void shouldRejectExistingAdmin() {
    RbacRole support = role(RbacIds.SUPPORT_ROLE_ID, "Support");
    User existing = user(UUID.randomUUID(), AccountState.ACTIVE);
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID)).thenReturn(Optional.of(support));
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(existing));
    when(roleAssignmentRepository.existsByUserIdAndRole(existing.getId(), Role.ADMIN))
        .thenReturn(true);

    assertThatThrownBy(
            () ->
                service.createAdmin(ACTOR, new CreateAdminRequestDto(PHONE, "X", support.getId())))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("createAdmin rejects a deleted account's phone")
  void shouldRejectDeletedAccountPhone() {
    RbacRole support = role(RbacIds.SUPPORT_ROLE_ID, "Support");
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID)).thenReturn(Optional.of(support));
    when(userRepository.findByPhone(PHONE))
        .thenReturn(Optional.of(user(UUID.randomUUID(), AccountState.DELETED)));

    assertThatThrownBy(
            () ->
                service.createAdmin(ACTOR, new CreateAdminRequestDto(PHONE, "X", support.getId())))
        .isInstanceOf(ConflictException.class);
  }

  @Test
  @DisplayName("the last active Super Admin can neither lose the role nor be deactivated")
  void shouldProtectLastActiveSuperAdmin() {
    UUID userId = UUID.randomUUID();
    RoleAssignment assignment =
        adminAssignment(userId, RbacIds.SUPER_ADMIN_ROLE_ID, RoleState.ACTIVE);
    when(roleAssignmentRepository.findByUserIdAndRole(userId, Role.ADMIN))
        .thenReturn(Optional.of(assignment));
    when(rbacRoleRepository.findById(RbacIds.SUPER_ADMIN_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPER_ADMIN_ROLE_ID, "Super Admin")));
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPPORT_ROLE_ID, "Support")));
    when(roleAssignmentRepository.isActiveHolder(userId, RbacIds.SUPER_ADMIN_ROLE_ID))
        .thenReturn(true);
    when(roleAssignmentRepository.countActiveHolders(RbacIds.SUPER_ADMIN_ROLE_ID)).thenReturn(1L);

    assertThatThrownBy(
            () ->
                service.changeRole(
                    ACTOR, userId, new ChangeAdminRoleRequestDto(RbacIds.SUPPORT_ROLE_ID)))
        .isInstanceOf(ConflictException.class);
    assertThatThrownBy(() -> service.deactivate(ACTOR, userId))
        .isInstanceOf(ConflictException.class);
  }

  @Test
  @DisplayName("changeRole swaps the single role and audits when another Super Admin remains")
  void shouldChangeRoleWhenNotLast() {
    UUID userId = UUID.randomUUID();
    RoleAssignment assignment =
        adminAssignment(userId, RbacIds.SUPER_ADMIN_ROLE_ID, RoleState.ACTIVE);
    when(roleAssignmentRepository.findByUserIdAndRole(userId, Role.ADMIN))
        .thenReturn(Optional.of(assignment));
    when(rbacRoleRepository.findById(RbacIds.SUPER_ADMIN_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPER_ADMIN_ROLE_ID, "Super Admin")));
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPPORT_ROLE_ID, "Support")));
    when(roleAssignmentRepository.isActiveHolder(userId, RbacIds.SUPER_ADMIN_ROLE_ID))
        .thenReturn(true);
    when(roleAssignmentRepository.countActiveHolders(RbacIds.SUPER_ADMIN_ROLE_ID)).thenReturn(2L);
    stubAssignmentSave();
    when(userRepository.findById(userId))
        .thenReturn(Optional.of(user(userId, AccountState.ACTIVE)));

    AdminAccountDto dto =
        service.changeRole(ACTOR, userId, new ChangeAdminRoleRequestDto(RbacIds.SUPPORT_ROLE_ID));

    assertThat(dto.role().name()).isEqualTo("Support");
    assertThat(assignment.getAdminRoleId()).isEqualTo(RbacIds.SUPPORT_ROLE_ID);
    verify(auditService)
        .record(
            eq(ACTOR), eq("admin.role_change"), eq("admin"), eq(userId.toString()), any(), any());
  }

  @Test
  @DisplayName("deactivate suspends a non-last admin; reactivate restores; no-ops skip auditing")
  void shouldDeactivateAndReactivate() {
    UUID userId = UUID.randomUUID();
    RoleAssignment assignment = adminAssignment(userId, RbacIds.SUPPORT_ROLE_ID, RoleState.ACTIVE);
    when(roleAssignmentRepository.findByUserIdAndRole(userId, Role.ADMIN))
        .thenReturn(Optional.of(assignment));
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPPORT_ROLE_ID, "Support")));
    when(userRepository.findById(userId))
        .thenReturn(Optional.of(user(userId, AccountState.ACTIVE)));
    stubAssignmentSave();

    AdminAccountDto deactivated = service.deactivate(ACTOR, userId);
    assertThat(deactivated.state()).isEqualTo(RoleState.SUSPENDED);
    verify(auditService)
        .record(
            eq(ACTOR), eq("admin.deactivate"), eq("admin"), eq(userId.toString()), any(), any());

    AdminAccountDto reactivated = service.reactivate(ACTOR, userId);
    assertThat(reactivated.state()).isEqualTo(RoleState.ACTIVE);
    verify(auditService)
        .record(
            eq(ACTOR), eq("admin.reactivate"), eq("admin"), eq(userId.toString()), any(), any());

    AdminAccountDto unchanged = service.reactivate(ACTOR, userId);
    assertThat(unchanged.state()).isEqualTo(RoleState.ACTIVE);
    // exactly one reactivate audit despite two calls: the no-op wrote nothing
    verify(auditService)
        .record(
            eq(ACTOR), eq("admin.reactivate"), eq("admin"), eq(userId.toString()), any(), any());
  }

  @Test
  @DisplayName("V1 audit W10: deactivate / reactivate notify the admin with the note, once")
  void shouldNotifyAdminOfRoleStateChanges() {
    UUID userId = UUID.randomUUID();
    RoleAssignment assignment = adminAssignment(userId, RbacIds.SUPPORT_ROLE_ID, RoleState.ACTIVE);
    when(roleAssignmentRepository.findByUserIdAndRole(userId, Role.ADMIN))
        .thenReturn(Optional.of(assignment));
    when(rbacRoleRepository.findById(RbacIds.SUPPORT_ROLE_ID))
        .thenReturn(Optional.of(role(RbacIds.SUPPORT_ROLE_ID, "Support")));
    when(userRepository.findById(userId))
        .thenReturn(Optional.of(user(userId, AccountState.ACTIVE)));
    stubAssignmentSave();

    service.deactivate(ACTOR, userId, "Left the team");
    verify(notificationService)
        .queue(
            userId,
            NotificationEvent.ROLE_SUSPENDED,
            java.util.Map.of("role", "admin", "note", "Left the team"));
    service.deactivate(ACTOR, userId, "again"); // a no-op: no second notice
    service.reactivate(ACTOR, userId, null);
    verify(notificationService)
        .queue(userId, NotificationEvent.ROLE_REACTIVATED, java.util.Map.of("role", "admin"));
    org.mockito.Mockito.verifyNoMoreInteractions(notificationService);
  }

  @Test
  @DisplayName("changeRole 404s when the user is not an admin")
  void shouldFailChangeRoleWhenNotAdmin() {
    UUID userId = UUID.randomUUID();
    when(roleAssignmentRepository.findByUserIdAndRole(userId, Role.ADMIN))
        .thenReturn(Optional.empty());

    assertThatThrownBy(
            () ->
                service.changeRole(
                    ACTOR, userId, new ChangeAdminRoleRequestDto(RbacIds.SUPPORT_ROLE_ID)))
        .isInstanceOf(ResourceNotFoundException.class);
  }
}
