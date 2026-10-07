package com.labby.backend.service;

import com.labby.backend.config.StorageProperties;
import com.labby.backend.dto.ChangePasswordRequestDto;
import com.labby.backend.dto.DeleteAccountRequestDto;
import com.labby.backend.dto.PhoneChangeStartRequestDto;
import com.labby.backend.dto.PhoneChangeVerifyRequestDto;
import com.labby.backend.dto.UpdateProfileRequestDto;
import com.labby.backend.dto.UserPhotoDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.exception.GoneException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceAlreadyExistsException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.exception.UnauthorizedException;
import com.labby.backend.model.User;
import com.labby.backend.repository.RefreshTokenRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.UserRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Own-account operations. The phone change is a strict three-step state machine held in memory:
 * nothing about the account mutates until the final step succeeds (ES-02); a restart simply
 * restarts the flow.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class MeServiceImpl implements MeService {

  private static final Duration PHONE_CHANGE_TTL = Duration.ofMinutes(15);
  private static final Map<String, String> ALLOWED_PHOTO_TYPES =
      Map.of("image/jpeg", ".jpg", "image/png", ".png", "image/webp", ".webp");

  private enum PhoneChangeStage {
    AWAITING_CURRENT,
    AWAITING_NEW
  }

  private record PhoneChangeSession(String newPhone, PhoneChangeStage stage, Instant expiresAt) {}

  private final Map<UUID, PhoneChangeSession> phoneChangeSessions = new ConcurrentHashMap<>();

  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RefreshTokenRepository refreshTokenRepository;
  private final OtpService otpService;
  private final PasswordEncoder passwordEncoder;
  private final StorageProvider storageProvider;
  private final StorageProperties storageProperties;
  private final ProfileService profileService;
  private final DeviceTokenService deviceTokenService;
  private final DriverApplicationService driverApplicationService;

  @Override
  @Transactional(readOnly = true)
  public UserProfileDto getProfile(UUID userId) {
    return toProfile(loadUsableUser(userId));
  }

  @Override
  public UserProfileDto updateProfile(UUID userId, UpdateProfileRequestDto request) {
    User user = loadUsableUser(userId);
    user.setName(request.name());
    user.setLanguage(request.language());
    return toProfile(userRepository.save(user));
  }

  @Override
  public void changePassword(UUID userId, UUID currentSessionId, ChangePasswordRequestDto request) {
    User user = loadUsableUser(userId);
    if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
      throw new InvalidRequestException("Wrong current password");
    }
    validateTwoFactor(user.getPhone(), request.otpCode());

    user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
    userRepository.save(user);

    Instant now = Instant.now();
    if (currentSessionId != null) {
      refreshTokenRepository.revokeAllByUserIdExcept(userId, currentSessionId, now);
    } else {
      refreshTokenRepository.revokeAllByUserId(userId, now);
    }
    // Tokens are not bound to a session, so every one goes — including this device's, which the
    // client registers again after the change (realtime-v1.yaml PUT /devices) — otherwise a
    // signed-out device would keep receiving the account's pushes.
    deviceTokenService.removeAllForUser(userId);
  }

  @Override
  public void requestTwoFactorCode(UUID userId) {
    User user = loadUsableUser(userId);
    otpService.issue(user.getPhone(), OtpPurpose.TWO_FA, user.getLanguage());
  }

  @Override
  public void phoneChangeStart(UUID userId, PhoneChangeStartRequestDto request) {
    User user = loadUsableUser(userId);
    assertPhoneFree(request.newPhone());

    otpService.issue(user.getPhone(), OtpPurpose.TWO_FA, user.getLanguage());
    phoneChangeSessions.put(
        userId,
        new PhoneChangeSession(
            request.newPhone(),
            PhoneChangeStage.AWAITING_CURRENT,
            Instant.now().plus(PHONE_CHANGE_TTL)));
  }

  @Override
  public void phoneChangeVerifyCurrent(UUID userId, PhoneChangeVerifyRequestDto request) {
    User user = loadUsableUser(userId);
    PhoneChangeSession session = liveSession(userId, PhoneChangeStage.AWAITING_CURRENT);

    try {
      otpService.validateAndConsume(user.getPhone(), OtpPurpose.TWO_FA, request.code());
    } catch (GoneException ex) {
      phoneChangeSessions.remove(userId);
      throw ex;
    }

    otpService.issue(session.newPhone(), OtpPurpose.TWO_FA, user.getLanguage());
    phoneChangeSessions.put(
        userId,
        new PhoneChangeSession(
            session.newPhone(),
            PhoneChangeStage.AWAITING_NEW,
            Instant.now().plus(PHONE_CHANGE_TTL)));
  }

  @Override
  public UserProfileDto phoneChangeComplete(UUID userId, PhoneChangeVerifyRequestDto request) {
    User user = loadUsableUser(userId);
    PhoneChangeSession session = liveSession(userId, PhoneChangeStage.AWAITING_NEW);

    try {
      otpService.validateAndConsume(session.newPhone(), OtpPurpose.TWO_FA, request.code());
    } catch (GoneException ex) {
      phoneChangeSessions.remove(userId);
      throw ex;
    }

    user.setPhone(session.newPhone());
    try {
      // Flush now so a concurrent registration of the same phone surfaces as the DB
      // unique-constraint violation (race-safe uniqueness).
      userRepository.saveAndFlush(user);
    } catch (DataIntegrityViolationException ex) {
      throw new ResourceAlreadyExistsException("Phone is already registered");
    }
    phoneChangeSessions.remove(userId);
    return toProfile(user);
  }

  @Override
  public void deleteAccount(UUID userId, DeleteAccountRequestDto request) {
    User user = loadUsableUser(userId);
    validateTwoFactor(user.getPhone(), request.otpCode());

    // No precondition checks in M2 — active-ride / driver-debt gates arrive with their
    // milestones (contract 409 reserved for them).
    // An open driver application leaves the review queue (owner decision 2026-10-07).
    driverApplicationService.withdrawForDeletedAccount(userId);
    user.setState(AccountState.DELETED);
    user.setDeletedAt(Instant.now());
    userRepository.save(user);
    refreshTokenRepository.revokeAllByUserId(userId, Instant.now());
    deviceTokenService.removeAllForUser(userId);
    phoneChangeSessions.remove(userId);
  }

  @Override
  public UserProfileDto updatePhoto(UUID userId, MultipartFile file) {
    User user = loadUsableUser(userId);

    String contentType = file.getContentType();
    String extension = contentType == null ? null : ALLOWED_PHOTO_TYPES.get(contentType);
    if (extension == null) {
      throw new InvalidRequestException("Unsupported image type; use JPEG, PNG, or WebP");
    }
    if (file.getSize() > storageProperties.photoMaxBytes()) {
      throw new InvalidRequestException("Image exceeds the maximum allowed size");
    }

    byte[] content;
    try {
      content = file.getBytes();
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to read upload", ex);
    }
    String key = storageProvider.store("photos/" + userId + extension, content);
    user.setPhotoPath(key);
    return toProfile(userRepository.save(user));
  }

  @Override
  @Transactional(readOnly = true)
  public UserPhotoDto getPhoto(UUID userId) {
    User user = loadUsableUser(userId);
    if (user.getPhotoPath() == null) {
      throw new ResourceNotFoundException("No profile photo is set");
    }
    return new UserPhotoDto(
        storageProvider.load(user.getPhotoPath()), contentTypeOf(user.getPhotoPath()));
  }

  private User loadUsableUser(UUID userId) {
    User user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UnauthorizedException("Authentication required"));
    if (user.getState() == AccountState.DELETED) {
      throw new UnauthorizedException("Authentication required");
    }
    return user;
  }

  private void validateTwoFactor(String phone, String code) {
    // The 2FA endpoints answer 400 for wrong AND expired codes (contract), so Gone is folded in.
    try {
      otpService.validateAndConsume(phone, OtpPurpose.TWO_FA, code);
    } catch (GoneException ex) {
      throw new InvalidRequestException("Wrong or expired code");
    }
  }

  private void assertPhoneFree(String phone) {
    userRepository
        .findByPhone(phone)
        .filter(existing -> existing.getState() != AccountState.DELETED)
        .ifPresent(
            existing -> {
              throw new ResourceAlreadyExistsException("Phone is already registered");
            });
  }

  private PhoneChangeSession liveSession(UUID userId, PhoneChangeStage expectedStage) {
    PhoneChangeSession session = phoneChangeSessions.get(userId);
    if (session == null
        || session.expiresAt().isBefore(Instant.now())
        || session.stage() != expectedStage) {
      phoneChangeSessions.remove(userId);
      throw new GoneException("Phone change expired or out of order; restart the flow");
    }
    return session;
  }

  private UserProfileDto toProfile(User user) {
    return profileService.profileFor(user, roleAssignmentRepository.findByUserId(user.getId()));
  }

  private static String contentTypeOf(String key) {
    for (Map.Entry<String, String> entry : ALLOWED_PHOTO_TYPES.entrySet()) {
      if (key.endsWith(entry.getValue())) {
        return entry.getKey();
      }
    }
    return "application/octet-stream";
  }
}
