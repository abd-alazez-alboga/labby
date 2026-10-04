package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.LoginRequestDto;
import com.labby.backend.dto.RefreshRequestDto;
import com.labby.backend.dto.RegisterStartRequestDto;
import com.labby.backend.dto.RegisterVerifyRequestDto;
import com.labby.backend.dto.RegisterVerifyResponseDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.enums.RegistrationMode;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.exception.UnauthorizedException;
import com.labby.backend.model.RefreshToken;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RefreshTokenRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.security.JwtService;
import com.labby.backend.service.AuthServiceImpl;
import com.labby.backend.service.LoginThrottle;
import com.labby.backend.service.OtpService;
import com.labby.backend.util.UserMapper;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mapstruct.factory.Mappers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Login role contexts, deleted-account neutrality, throttling, refresh rotation/reuse. */
@ExtendWith(MockitoExtension.class)
class AuthServiceImplTest {

  private static final String PHONE = "+963900000200";
  private static final String IP = "10.0.0.1";

  @Mock private UserRepository userRepository;
  @Mock private RoleAssignmentRepository roleAssignmentRepository;
  @Mock private RefreshTokenRepository refreshTokenRepository;
  @Mock private OtpService otpService;
  @Mock private JwtService jwtService;
  @Mock private LoginThrottle loginThrottle;

  private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);
  private final UserMapper userMapper = Mappers.getMapper(UserMapper.class);

  private AuthServiceImpl authService;
  private User user;

  @BeforeEach
  void setUp() {
    authService =
        new AuthServiceImpl(
            userRepository,
            roleAssignmentRepository,
            refreshTokenRepository,
            otpService,
            jwtService,
            passwordEncoder,
            loginThrottle,
            userMapper,
            new AuthProperties("test-secret-test-secret-test-secret!!", 900, 1209600, 10, 900));
    user =
        User.builder()
            .phone(PHONE)
            .passwordHash(passwordEncoder.encode("Secret123!"))
            .name("Unit User")
            .build();
    user.setId(UUID.randomUUID());
  }

  private void stubSessionIssuing() {
    when(refreshTokenRepository.save(any(RefreshToken.class)))
        .thenAnswer(
            invocation -> {
              RefreshToken token = invocation.getArgument(0);
              token.setId(UUID.randomUUID());
              return token;
            });
    when(jwtService.issueAccessToken(any(), any(), anyList())).thenReturn("access-token");
  }

  private List<RoleAssignment> roles(Role... values) {
    return Arrays.stream(values)
        .map(role -> RoleAssignment.builder().userId(user.getId()).role(role).build())
        .toList();
  }

  @Test
  @DisplayName("rider client logs in with the rider role")
  void shouldIssueSessionWhenRiderLogsInOnRiderClient() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));
    when(roleAssignmentRepository.findByUserId(user.getId())).thenReturn(roles(Role.RIDER));
    stubSessionIssuing();

    AuthTokensResponseDto response =
        authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.RIDER), IP);

    assertThat(response.accessToken()).isEqualTo("access-token");
    assertThat(response.refreshToken()).isNotBlank();
    assertThat(response.user().phone()).isEqualTo(PHONE);
    verify(loginThrottle).reset(PHONE, IP);
  }

  @Test
  @DisplayName("driver client accepts rider-or-driver role; the app gates on roles")
  void shouldIssueSessionWhenRiderOnlyAccountUsesDriverClient() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));
    when(roleAssignmentRepository.findByUserId(user.getId())).thenReturn(roles(Role.RIDER));
    stubSessionIssuing();

    AuthTokensResponseDto response =
        authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.DRIVER), IP);

    assertThat(response.user().roles()).hasSize(1);
  }

  @Test
  @DisplayName("admin client rejects accounts without the admin role (403)")
  void shouldThrowForbiddenWhenAdminClientWithoutAdminRole() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));
    when(roleAssignmentRepository.findByUserId(user.getId()))
        .thenReturn(roles(Role.RIDER, Role.DRIVER));

    assertThatThrownBy(
            () -> authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.ADMIN), IP))
        .isInstanceOf(ForbiddenException.class);
    verify(loginThrottle, never()).recordFailure(anyString(), anyString());
  }

  @Test
  @DisplayName("rider client rejects an admin-only account (403)")
  void shouldThrowForbiddenWhenRiderClientWithAdminOnlyAccount() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));
    when(roleAssignmentRepository.findByUserId(user.getId())).thenReturn(roles(Role.ADMIN));

    assertThatThrownBy(
            () -> authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.RIDER), IP))
        .isInstanceOf(ForbiddenException.class);
  }

  @Test
  @DisplayName("deleted accounts and wrong passwords are indistinguishable 401s")
  void shouldAnswerIdenticallyWhenAccountDeletedOrPasswordWrong() {
    user.setState(AccountState.DELETED);
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));
    Throwable deleted =
        catchThrowable(
            () ->
                authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.RIDER), IP));

    user.setState(AccountState.ACTIVE);
    Throwable wrongPassword =
        catchThrowable(
            () ->
                authService.login(new LoginRequestDto(PHONE, "WrongPass!", ClientType.RIDER), IP));

    assertThat(deleted).isInstanceOf(UnauthorizedException.class);
    assertThat(wrongPassword).isInstanceOf(UnauthorizedException.class);
    assertThat(deleted.getMessage()).isEqualTo(wrongPassword.getMessage());
    verify(loginThrottle, times(2)).recordFailure(PHONE, IP);
  }

  @Test
  @DisplayName("a throttled phone+IP answers 429 before any credential work")
  void shouldThrowTooManyRequestsWhenThrottled() {
    doThrow(new TooManyRequestsException("throttled")).when(loginThrottle).check(PHONE, IP);

    assertThatThrownBy(
            () -> authService.login(new LoginRequestDto(PHONE, "Secret123!", ClientType.RIDER), IP))
        .isInstanceOf(TooManyRequestsException.class);
    verifyNoInteractions(userRepository);
  }

  @Test
  @DisplayName("register start answers 409 for a usable account")
  void shouldThrowConflictWhenRegisterStartOnActivePhone() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));

    assertThatThrownBy(() -> authService.registerStart(new RegisterStartRequestDto(PHONE)))
        .isInstanceOf(ResourceAlreadyExistsException.class);
    verifyNoInteractions(otpService);
  }

  @Test
  @DisplayName("register verify reactivates a deleted account without issuing a token")
  void shouldReactivateWhenRegisterVerifyOnDeletedAccount() {
    user.setState(AccountState.DELETED);
    user.setDeletedAt(Instant.now());
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.of(user));

    RegisterVerifyResponseDto response =
        authService.registerVerify(new RegisterVerifyRequestDto(PHONE, "123456"));

    verify(otpService).validateAndConsume(PHONE, OtpPurpose.REGISTER, "123456");
    assertThat(response.mode()).isEqualTo(RegistrationMode.REACTIVATED);
    assertThat(response.registrationToken()).isNull();
    assertThat(user.getState()).isEqualTo(AccountState.ACTIVE);
    assertThat(user.getDeletedAt()).isNull();
    verify(jwtService, never()).issueRegistrationToken(anyString());
  }

  @Test
  @DisplayName("register verify hands a registration token to new phones")
  void shouldIssueRegistrationTokenWhenPhoneNew() {
    when(userRepository.findByPhone(PHONE)).thenReturn(Optional.empty());
    when(jwtService.issueRegistrationToken(PHONE)).thenReturn("reg-token");

    RegisterVerifyResponseDto response =
        authService.registerVerify(new RegisterVerifyRequestDto(PHONE, "123456"));

    assertThat(response.mode()).isEqualTo(RegistrationMode.NEW);
    assertThat(response.registrationToken()).isEqualTo("reg-token");
  }

  @Test
  @DisplayName("refresh rotates: old token revoked, new token stored")
  void shouldRotateWhenRefreshTokenValid() {
    RefreshToken stored =
        RefreshToken.builder()
            .userId(user.getId())
            .tokenHash("hash")
            .expiresAt(Instant.now().plusSeconds(3600))
            .build();
    stored.setId(UUID.randomUUID());
    when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(stored));
    when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));
    when(roleAssignmentRepository.findByUserId(user.getId())).thenReturn(roles(Role.RIDER));
    stubSessionIssuing();

    AuthTokensResponseDto response = authService.refresh(new RefreshRequestDto("raw-token"));

    assertThat(stored.getRevokedAt()).isNotNull();
    assertThat(response.refreshToken()).isNotBlank();
    verify(refreshTokenRepository, never()).revokeAllByUserId(any(), any());
  }

  @Test
  @DisplayName("reuse of a revoked token revokes the whole family and answers 401")
  void shouldRevokeFamilyWhenRevokedTokenReused() {
    RefreshToken revoked =
        RefreshToken.builder()
            .userId(user.getId())
            .tokenHash("hash")
            .expiresAt(Instant.now().plusSeconds(3600))
            .revokedAt(Instant.now().minusSeconds(5))
            .build();
    when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(revoked));

    assertThatThrownBy(() -> authService.refresh(new RefreshRequestDto("raw-token")))
        .isInstanceOf(UnauthorizedException.class);
    verify(refreshTokenRepository).revokeAllByUserId(eq(user.getId()), any());
  }

  @Test
  @DisplayName("an expired refresh token answers 401 and is revoked")
  void shouldRejectWhenRefreshTokenExpired() {
    RefreshToken expired =
        RefreshToken.builder()
            .userId(user.getId())
            .tokenHash("hash")
            .expiresAt(Instant.now().minusSeconds(5))
            .build();
    when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(expired));

    assertThatThrownBy(() -> authService.refresh(new RefreshRequestDto("raw-token")))
        .isInstanceOf(UnauthorizedException.class);
    assertThat(expired.getRevokedAt()).isNotNull();
  }
}
