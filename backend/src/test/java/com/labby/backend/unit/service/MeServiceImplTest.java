package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.ChangePasswordRequestDto;
import com.labby.backend.dto.DeleteAccountRequestDto;
import com.labby.backend.dto.PhoneChangeStartRequestDto;
import com.labby.backend.dto.PhoneChangeVerifyRequestDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.enums.PhoneChangeStage;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.GoneException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.model.PhoneChangeSession;
import com.labby.backend.model.User;
import com.labby.backend.repository.PhoneChangeSessionRepository;
import com.labby.backend.repository.RbacRoleRepository;
import com.labby.backend.repository.RefreshTokenRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.service.AccountDeletionGates;
import com.labby.backend.service.DeviceTokenService;
import com.labby.backend.service.DriverApplicationService;
import com.labby.backend.service.MeServiceImpl;
import com.labby.backend.service.OtpService;
import com.labby.backend.service.ProfileServiceImpl;
import com.labby.backend.service.StorageProvider;
import com.labby.backend.util.UserMapper;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Phone-change state machine, 2FA gates, and soft delete (AUTH-05, USR-07, ES-02). */
@ExtendWith(MockitoExtension.class)
class MeServiceImplTest {

  private static final String CURRENT_PHONE = "+963900000300";
  private static final String NEW_PHONE = "+963900000301";

  @Mock private UserRepository userRepository;
  @Mock private RoleAssignmentRepository roleAssignmentRepository;
  @Mock private RefreshTokenRepository refreshTokenRepository;
  @Mock private OtpService otpService;
  @Mock private StorageProvider storageProvider;
  @Mock private DeviceTokenService deviceTokenService;
  @Mock private DriverApplicationService driverApplicationService;
  @Mock private PhoneChangeSessionRepository phoneChangeSessionRepository;
  @Mock private AccountDeletionGates accountDeletionGates;

  /** The phone_change_sessions table behind the repository mock (one row per account). */
  private final Map<UUID, PhoneChangeSession> phoneChanges = new HashMap<>();

  private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);
  @Mock private RbacRoleRepository rbacRoleRepository;

  private final UserMapper userMapper = Mappers.getMapper(UserMapper.class);

  private MeServiceImpl meService;
  private User user;
  private UUID userId;

  @BeforeEach
  void setUp() {
    meService =
        new MeServiceImpl(
            userRepository,
            roleAssignmentRepository,
            refreshTokenRepository,
            otpService,
            passwordEncoder,
            storageProvider,
            new StorageProperties("/tmp/labby-test", 5_242_880, 10_485_760, 300, 50, 7),
            new ProfileServiceImpl(userMapper, rbacRoleRepository),
            deviceTokenService,
            driverApplicationService,
            phoneChangeSessionRepository,
            accountDeletionGates);
    userId = UUID.randomUUID();
    user =
        User.builder()
            .phone(CURRENT_PHONE)
            .passwordHash(passwordEncoder.encode("Secret123!"))
            .name("Me User")
            .build();
    user.setId(userId);
    when(userRepository.findById(userId)).thenReturn(Optional.of(user));
    lenient()
        .when(phoneChangeSessionRepository.findById(any()))
        .thenAnswer(invocation -> Optional.ofNullable(phoneChanges.get(invocation.getArgument(0))));
    lenient()
        .doAnswer(
            invocation -> {
              UUID owner = invocation.getArgument(0);
              phoneChanges.put(
                  owner,
                  PhoneChangeSession.builder()
                      .userId(owner)
                      .newPhone(invocation.getArgument(1))
                      .stage(PhoneChangeStage.fromValue(invocation.getArgument(2)))
                      .expiresAt(invocation.getArgument(3))
                      .build());
              return null;
            })
        .when(phoneChangeSessionRepository)
        .upsert(any(), any(), any(), any());
    lenient()
        .when(phoneChangeSessionRepository.deleteForUser(any()))
        .thenAnswer(invocation -> phoneChanges.remove(invocation.getArgument(0)) == null ? 0 : 1);
  }

  @Test
  @DisplayName("phone change start rejects a taken phone and sends nothing")
  void shouldRejectStartWhenNewPhoneTaken() {
    User occupant = User.builder().phone(NEW_PHONE).passwordHash("x").name("Other").build();
    occupant.setId(UUID.randomUUID());
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.of(occupant));

    assertThatThrownBy(
            () -> meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE)))
        .isInstanceOf(ResourceAlreadyExistsException.class);
    verify(otpService, never()).issue(anyString(), any(), any());
  }

  @Test
  @DisplayName(
      "review V1 W12: a phone held by a deleted account is refused at start with its own code")
  void shouldRejectStartWhenNewPhoneHeldByDeletedAccount() {
    User deleted = User.builder().phone(NEW_PHONE).passwordHash("x").name("Gone").build();
    deleted.setId(UUID.randomUUID());
    deleted.setState(AccountState.DELETED);
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.of(deleted));

    assertThatThrownBy(
            () -> meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE)))
        .isInstanceOf(ResourceAlreadyExistsException.class)
        .extracting("code")
        .isEqualTo("phone_held_by_deleted_account");
    verify(otpService, never()).issue(anyString(), any(), any());
    assertThat(phoneChanges).isEmpty();
  }

  @Test
  @DisplayName("phone change steps answer Gone when run out of order")
  void shouldThrowGoneWhenStepsOutOfOrder() {
    assertThatThrownBy(
            () ->
                meService.phoneChangeVerifyCurrent(
                    userId, new PhoneChangeVerifyRequestDto("111111")))
        .isInstanceOf(GoneException.class);
    assertThatThrownBy(
            () -> meService.phoneChangeComplete(userId, new PhoneChangeVerifyRequestDto("111111")))
        .isInstanceOf(GoneException.class);
    verify(userRepository, never()).saveAndFlush(any());
  }

  @Test
  @DisplayName("the full 3-step flow mutates the phone only at the very end")
  void shouldChangePhoneWhenAllStepsPass() {
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.empty());
    when(userRepository.saveAndFlush(user)).thenReturn(user);
    when(roleAssignmentRepository.findByUserId(userId)).thenReturn(List.of());

    meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE));
    verify(otpService).issue(CURRENT_PHONE, OtpPurpose.TWO_FA, Language.EN);
    assertThat(user.getPhone()).isEqualTo(CURRENT_PHONE);

    meService.phoneChangeVerifyCurrent(userId, new PhoneChangeVerifyRequestDto("111111"));
    verify(otpService).validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "111111");
    verify(otpService).issue(NEW_PHONE, OtpPurpose.TWO_FA, Language.EN);
    assertThat(user.getPhone()).isEqualTo(CURRENT_PHONE);

    UserProfileDto profile =
        meService.phoneChangeComplete(userId, new PhoneChangeVerifyRequestDto("222222"));
    verify(otpService).validateAndConsume(NEW_PHONE, OtpPurpose.TWO_FA, "222222");
    assertThat(profile.phone()).isEqualTo(NEW_PHONE);
    assertThat(user.getPhone()).isEqualTo(NEW_PHONE);
  }

  @Test
  @DisplayName("a wrong code mid-flow mutates nothing and keeps the flow alive")
  void shouldKeepStateWhenCodeWrongMidFlow() {
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.empty());
    meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE));

    doThrow(new InvalidRequestException("Wrong code"))
        .when(otpService)
        .validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "999999");
    assertThatThrownBy(
            () ->
                meService.phoneChangeVerifyCurrent(
                    userId, new PhoneChangeVerifyRequestDto("999999")))
        .isInstanceOf(InvalidRequestException.class);
    assertThat(user.getPhone()).isEqualTo(CURRENT_PHONE);
    verify(userRepository, never()).saveAndFlush(any());

    // The session survives a wrong code: a correct retry still works.
    meService.phoneChangeVerifyCurrent(userId, new PhoneChangeVerifyRequestDto("111111"));
    verify(otpService).issue(NEW_PHONE, OtpPurpose.TWO_FA, Language.EN);
  }

  @Test
  @DisplayName("a Gone OTP mid-flow clears the session: the flow must restart")
  void shouldClearSessionWhenOtpGoneMidFlow() {
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.empty());
    meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE));

    doThrow(new GoneException("expired"))
        .when(otpService)
        .validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "111111");
    assertThatThrownBy(
            () ->
                meService.phoneChangeVerifyCurrent(
                    userId, new PhoneChangeVerifyRequestDto("111111")))
        .isInstanceOf(GoneException.class);

    // Session is gone now — even a fine code answers Gone.
    assertThatThrownBy(
            () ->
                meService.phoneChangeVerifyCurrent(
                    userId, new PhoneChangeVerifyRequestDto("111111")))
        .isInstanceOf(GoneException.class);
  }

  @Test
  @DisplayName("an expired phone change answers Gone and is removed")
  void shouldThrowGoneAndRemoveSessionWhenExpired() {
    phoneChanges.put(
        userId,
        PhoneChangeSession.builder()
            .userId(userId)
            .newPhone(NEW_PHONE)
            .stage(PhoneChangeStage.AWAITING_CURRENT)
            .expiresAt(Instant.now().minusSeconds(1))
            .build());

    assertThatThrownBy(
            () ->
                meService.phoneChangeVerifyCurrent(
                    userId, new PhoneChangeVerifyRequestDto("111111")))
        .isInstanceOf(GoneException.class);
    assertThat(phoneChanges).doesNotContainKey(userId);
    verify(otpService, never()).validateAndConsume(anyString(), any(), anyString());
  }

  @Test
  @DisplayName("a concurrent registration of the new phone surfaces as 409 at complete")
  void shouldThrowConflictWhenUniqueConstraintHitAtComplete() {
    when(userRepository.findByPhone(NEW_PHONE)).thenReturn(Optional.empty());
    meService.phoneChangeStart(userId, new PhoneChangeStartRequestDto(NEW_PHONE));
    meService.phoneChangeVerifyCurrent(userId, new PhoneChangeVerifyRequestDto("111111"));

    when(userRepository.saveAndFlush(user))
        .thenThrow(new DataIntegrityViolationException("uq_users_phone"));

    assertThatThrownBy(
            () -> meService.phoneChangeComplete(userId, new PhoneChangeVerifyRequestDto("222222")))
        .isInstanceOf(ResourceAlreadyExistsException.class);
  }

  @Test
  @DisplayName("password change rejects a wrong current password before touching the OTP")
  void shouldRejectChangePasswordWhenCurrentWrong() {
    assertThatThrownBy(
            () ->
                meService.changePassword(
                    userId,
                    null,
                    new ChangePasswordRequestDto("WrongPass!", "111111", "NewSecret1!")))
        .isInstanceOf(InvalidRequestException.class);
    verify(otpService, never()).validateAndConsume(anyString(), any(), anyString());
  }

  @Test
  @DisplayName("an expired 2FA OTP folds into 400 on password change (contract)")
  void shouldAnswerBadRequestWhenTwoFactorOtpGone() {
    doThrow(new GoneException("expired"))
        .when(otpService)
        .validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "111111");

    assertThatThrownBy(
            () ->
                meService.changePassword(
                    userId,
                    null,
                    new ChangePasswordRequestDto("Secret123!", "111111", "NewSecret1!")))
        .isInstanceOf(InvalidRequestException.class);
  }

  @Test
  @DisplayName(
      "password change keeps the current session, revokes the others and drops every push token")
  void shouldRevokeOtherSessionsWhenPasswordChanged() {
    UUID sessionId = UUID.randomUUID();
    when(userRepository.save(user)).thenReturn(user);

    meService.changePassword(
        userId, sessionId, new ChangePasswordRequestDto("Secret123!", "111111", "NewSecret1!"));

    verify(otpService).validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "111111");
    assertThat(passwordEncoder.matches("NewSecret1!", user.getPasswordHash())).isTrue();
    verify(refreshTokenRepository).revokeAllByUserIdExcept(eq(userId), eq(sessionId), any());
    verify(refreshTokenRepository, never()).revokeAllByUserId(any(), any());
    verify(deviceTokenService).removeAllForUser(userId);
  }

  @Test
  @DisplayName("soft delete flips state, stamps deleted_at, revokes all sessions and push tokens")
  void shouldSoftDeleteWhenTwoFactorValid() {
    when(userRepository.save(user)).thenReturn(user);

    meService.deleteAccount(userId, new DeleteAccountRequestDto("111111"));

    verify(otpService).validateAndConsume(CURRENT_PHONE, OtpPurpose.TWO_FA, "111111");
    assertThat(user.getState()).isEqualTo(AccountState.DELETED);
    assertThat(user.getDeletedAt()).isNotNull();
    verify(refreshTokenRepository).revokeAllByUserId(eq(userId), any());
    verify(deviceTokenService).removeAllForUser(userId);
    // An open driver application is withdrawn with the account (owner decision 2026-10-07).
    verify(driverApplicationService).withdrawForDeletedAccount(userId);
    // Review V1 H1 / W13: the gates ran, and pending activity ended with the account.
    verify(accountDeletionGates).requireDeletable(userId);
    verify(accountDeletionGates).cleanUp(userId);
  }

  @Test
  @DisplayName("review V1 H1: a blocked deletion keeps the 2FA code and changes nothing")
  void shouldKeepCodeWhenDeletionBlocked() {
    doThrow(new ConflictException("Finish the active ride first").withCode("active_ride"))
        .when(accountDeletionGates)
        .requireDeletable(userId);

    assertThatThrownBy(() -> meService.deleteAccount(userId, new DeleteAccountRequestDto("111111")))
        .isInstanceOf(ConflictException.class)
        .extracting("code")
        .isEqualTo("active_ride");
    verify(otpService, never()).validateAndConsume(anyString(), any(), anyString());
    verify(accountDeletionGates, never()).cleanUp(any());
    assertThat(user.getState()).isEqualTo(AccountState.ACTIVE);
  }
}
