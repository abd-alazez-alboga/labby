package com.labby.backend.service;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.LoginRequestDto;
import com.labby.backend.dto.PasswordResetCompleteRequestDto;
import com.labby.backend.dto.PasswordResetStartRequestDto;
import com.labby.backend.dto.PasswordResetVerifyRequestDto;
import com.labby.backend.dto.PasswordResetVerifyResponseDto;
import com.labby.backend.dto.RefreshRequestDto;
import com.labby.backend.dto.RegisterCompleteRequestDto;
import com.labby.backend.dto.RegisterStartRequestDto;
import com.labby.backend.dto.RegisterVerifyRequestDto;
import com.labby.backend.dto.RegisterVerifyResponseDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.enums.RegistrationMode;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.SmsDeliveryException;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.exception.UnauthorizedException;
import com.labby.backend.model.RefreshToken;
import com.labby.backend.model.RoleAssignment;
import com.labby.backend.model.User;
import com.labby.backend.repository.RefreshTokenRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.security.JwtService;
import com.labby.backend.util.UserMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registration, login, refresh rotation, and password reset. Deleted accounts are indistinguishable
 * from nonexistent ones on login and reset (NFR-S3); re-registering their phone reactivates them
 * (USR-07).
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final String BAD_CREDENTIALS = "Invalid phone or password";

  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RefreshTokenRepository refreshTokenRepository;
  private final OtpService otpService;
  private final JwtService jwtService;
  private final PasswordEncoder passwordEncoder;
  private final LoginThrottle loginThrottle;
  private final UserMapper userMapper;
  private final AuthProperties authProperties;

  @Override
  public void registerStart(RegisterStartRequestDto request) {
    User existing = userRepository.findByPhone(request.phone()).orElse(null);
    if (existing != null && existing.getState() != AccountState.DELETED) {
      throw new ResourceAlreadyExistsException("Phone is already registered");
    }
    Language language = existing == null ? Language.EN : existing.getLanguage();
    otpService.issue(request.phone(), OtpPurpose.REGISTER, language);
  }

  @Override
  public RegisterVerifyResponseDto registerVerify(RegisterVerifyRequestDto request) {
    otpService.validateAndConsume(request.phone(), OtpPurpose.REGISTER, request.code());

    User existing = userRepository.findByPhone(request.phone()).orElse(null);
    if (existing != null) {
      if (existing.getState() != AccountState.DELETED) {
        throw new ResourceAlreadyExistsException("Phone is already registered");
      }
      existing.setState(AccountState.ACTIVE);
      existing.setDeletedAt(null);
      userRepository.save(existing);
      return new RegisterVerifyResponseDto(RegistrationMode.REACTIVATED, null);
    }
    return new RegisterVerifyResponseDto(
        RegistrationMode.NEW, jwtService.issueRegistrationToken(request.phone()));
  }

  @Override
  public AuthTokensResponseDto registerComplete(RegisterCompleteRequestDto request) {
    String phone =
        jwtService
            .parseRegistrationToken(request.registrationToken())
            .orElseThrow(
                () -> new InvalidRequestException("Invalid or expired registration token"));

    if (userRepository.findByPhone(phone).isPresent()) {
      throw new ResourceAlreadyExistsException("Phone is already registered");
    }

    User user;
    try {
      user =
          userRepository.saveAndFlush(
              User.builder()
                  .phone(phone)
                  .passwordHash(passwordEncoder.encode(request.password()))
                  .name(request.name())
                  .termsAcceptedAt(Instant.now())
                  .build());
    } catch (DataIntegrityViolationException ex) {
      throw new ResourceAlreadyExistsException("Phone is already registered");
    }
    roleAssignmentRepository.save(
        RoleAssignment.builder().userId(user.getId()).role(Role.RIDER).build());

    return issueSession(user);
  }

  @Override
  public AuthTokensResponseDto login(LoginRequestDto request, String clientIp) {
    loginThrottle.check(request.phone(), clientIp);

    User user = userRepository.findByPhone(request.phone()).orElse(null);
    boolean usable = user != null && user.getState() != AccountState.DELETED;
    if (!usable || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
      loginThrottle.recordFailure(request.phone(), clientIp);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    List<RoleAssignment> roles = roleAssignmentRepository.findByUserId(user.getId());
    if (!holdsRoleForClient(roles, request.client())) {
      throw new ForbiddenException("Account holds no role valid for this client");
    }

    loginThrottle.reset(request.phone(), clientIp);
    return issueSession(user, roles);
  }

  @Override
  @Transactional(noRollbackFor = UnauthorizedException.class)
  public AuthTokensResponseDto refresh(RefreshRequestDto request) {
    RefreshToken token =
        refreshTokenRepository
            .findByTokenHash(sha256(request.refreshToken()))
            .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));

    if (token.getRevokedAt() != null) {
      // Reuse of a rotated/revoked token: revoke the whole family (every live session).
      refreshTokenRepository.revokeAllByUserId(token.getUserId(), Instant.now());
      log.warn("Refresh-token reuse detected for user {}; all sessions revoked", token.getUserId());
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (token.getExpiresAt().isBefore(Instant.now())) {
      token.setRevokedAt(Instant.now());
      refreshTokenRepository.save(token);
      throw new UnauthorizedException("Invalid refresh token");
    }

    User user =
        userRepository
            .findById(token.getUserId())
            .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));
    if (user.getState() == AccountState.DELETED) {
      refreshTokenRepository.revokeAllByUserId(user.getId(), Instant.now());
      throw new UnauthorizedException("Invalid refresh token");
    }

    token.setRevokedAt(Instant.now());
    refreshTokenRepository.save(token);
    return issueSession(user);
  }

  @Override
  public void logout(RefreshRequestDto request) {
    refreshTokenRepository
        .findByTokenHash(sha256(request.refreshToken()))
        .filter(token -> token.getRevokedAt() == null)
        .ifPresent(
            token -> {
              token.setRevokedAt(Instant.now());
              refreshTokenRepository.save(token);
            });
  }

  @Override
  public void passwordResetStart(PasswordResetStartRequestDto request) {
    User user = userRepository.findByPhone(request.phone()).orElse(null);
    if (user == null || user.getState() == AccountState.DELETED) {
      return; // Neutral 204: no account enumeration (NFR-S3).
    }
    try {
      otpService.issue(request.phone(), OtpPurpose.RESET, user.getLanguage());
    } catch (TooManyRequestsException | SmsDeliveryException ex) {
      // Still neutral: rate limits and delivery failures surface identically as 204.
      log.warn("Password-reset OTP not sent for an existing phone: {}", ex.getMessage());
    }
  }

  @Override
  public PasswordResetVerifyResponseDto passwordResetVerify(PasswordResetVerifyRequestDto request) {
    otpService.validateAndConsume(request.phone(), OtpPurpose.RESET, request.code());
    User user =
        userRepository
            .findByPhone(request.phone())
            .orElseThrow(() -> new InvalidRequestException("Invalid reset request"));
    return new PasswordResetVerifyResponseDto(jwtService.issueResetToken(user.getId()));
  }

  @Override
  public void passwordResetComplete(PasswordResetCompleteRequestDto request) {
    UUID userId =
        jwtService
            .parseResetToken(request.resetToken())
            .orElseThrow(() -> new InvalidRequestException("Invalid or expired reset token"));
    User user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidRequestException("Invalid or expired reset token"));

    user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
    userRepository.save(user);
    refreshTokenRepository.revokeAllByUserId(user.getId(), Instant.now());
  }

  private AuthTokensResponseDto issueSession(User user) {
    return issueSession(user, roleAssignmentRepository.findByUserId(user.getId()));
  }

  private AuthTokensResponseDto issueSession(User user, List<RoleAssignment> roles) {
    byte[] raw = new byte[32];
    RANDOM.nextBytes(raw);
    String refreshToken = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

    RefreshToken stored =
        refreshTokenRepository.save(
            RefreshToken.builder()
                .userId(user.getId())
                .tokenHash(sha256(refreshToken))
                .expiresAt(Instant.now().plusSeconds(authProperties.refreshTtlSeconds()))
                .build());

    List<String> roleValues = roles.stream().map(role -> role.getRole().getValue()).toList();
    String accessToken = jwtService.issueAccessToken(user.getId(), stored.getId(), roleValues);

    return new AuthTokensResponseDto(
        accessToken,
        refreshToken,
        authProperties.accessTtlSeconds(),
        userMapper.toProfileDto(user, roles));
  }

  private static boolean holdsRoleForClient(List<RoleAssignment> roles, ClientType client) {
    Set<Role> held = roles.stream().map(RoleAssignment::getRole).collect(Collectors.toSet());
    return switch (client) {
      case RIDER -> held.contains(Role.RIDER);
      case DRIVER -> held.contains(Role.RIDER) || held.contains(Role.DRIVER);
      case ADMIN -> held.contains(Role.ADMIN);
    };
  }

  private static String sha256(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 unavailable", ex);
    }
  }
}
