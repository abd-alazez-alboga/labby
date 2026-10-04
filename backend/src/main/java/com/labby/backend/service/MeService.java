package com.labby.backend.service;

import com.labby.backend.dto.ChangePasswordRequestDto;
import com.labby.backend.dto.DeleteAccountRequestDto;
import com.labby.backend.dto.PhoneChangeStartRequestDto;
import com.labby.backend.dto.PhoneChangeVerifyRequestDto;
import com.labby.backend.dto.UpdateProfileRequestDto;
import com.labby.backend.dto.UserPhotoDto;
import com.labby.backend.dto.UserProfileDto;
import java.util.UUID;
import org.springframework.web.multipart.MultipartFile;

/** Own-account operations: profile, 2FA-gated changes, phone change, soft delete (USR-03..07). */
public interface MeService {

  /**
   * Returns the own profile.
   *
   * @param userId the authenticated account
   * @return the profile
   */
  UserProfileDto getProfile(UUID userId);

  /**
   * Updates name and language.
   *
   * @param userId the authenticated account
   * @param request name + language
   * @return the updated profile
   */
  UserProfileDto updateProfile(UUID userId, UpdateProfileRequestDto request);

  /**
   * Changes the password behind current-password + 2FA OTP; revokes the other sessions (AUTH-05).
   *
   * @param userId the authenticated account
   * @param currentSessionId the session to keep alive, when known
   * @param request current password + OTP + new password
   */
  void changePassword(UUID userId, UUID currentSessionId, ChangePasswordRequestDto request);

  /**
   * Sends a 2FA OTP to the account's own phone.
   *
   * @param userId the authenticated account
   */
  void requestTwoFactorCode(UUID userId);

  /**
   * Phone change step 1: declare the new phone; OTP goes to the CURRENT phone.
   *
   * @param userId the authenticated account
   * @param request the new phone
   */
  void phoneChangeStart(UUID userId, PhoneChangeStartRequestDto request);

  /**
   * Phone change step 2: prove the current phone; OTP then goes to the NEW phone.
   *
   * @param userId the authenticated account
   * @param request the code sent to the current phone
   */
  void phoneChangeVerifyCurrent(UUID userId, PhoneChangeVerifyRequestDto request);

  /**
   * Phone change step 3: prove the new phone; only now does the phone mutate (ES-02).
   *
   * @param userId the authenticated account
   * @param request the code sent to the new phone
   * @return the updated profile
   */
  UserProfileDto phoneChangeComplete(UUID userId, PhoneChangeVerifyRequestDto request);

  /**
   * Soft-deletes the account behind 2FA: state deleted, data retained, sessions revoked (USR-07).
   *
   * @param userId the authenticated account
   * @param request the 2FA OTP
   */
  void deleteAccount(UUID userId, DeleteAccountRequestDto request);

  /**
   * Stores/replaces the private profile photo (NFR-S2).
   *
   * @param userId the authenticated account
   * @param file the multipart image
   * @return the updated profile with photoUrl set
   */
  UserProfileDto updatePhoto(UUID userId, MultipartFile file);

  /**
   * Serves the own profile photo (owner-only in M2).
   *
   * @param userId the authenticated account
   * @return the photo bytes and media type
   */
  UserPhotoDto getPhoto(UUID userId);
}
