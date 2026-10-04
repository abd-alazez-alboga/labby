package com.labby.backend.service;

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

/** Registration, login, session, and password-reset flows (AUTH-01..05). */
public interface AuthService {

  /**
   * Sends a registration OTP; 409 when the phone belongs to a usable account.
   *
   * @param request the phone
   */
  void registerStart(RegisterStartRequestDto request);

  /**
   * Verifies the registration OTP: new phones get a registration token; a deleted account's phone
   * reactivates the account immediately (USR-07).
   *
   * @param request phone + code
   * @return the mode and, for new phones, the registration token
   */
  RegisterVerifyResponseDto registerVerify(RegisterVerifyRequestDto request);

  /**
   * Creates the account (active, rider role) and issues a session.
   *
   * @param request registration token + password + name
   * @return the issued session
   */
  AuthTokensResponseDto registerComplete(RegisterCompleteRequestDto request);

  /**
   * Phone + password login with per-client role check; never OTP-gated (AUTH-02, AUTH-05).
   *
   * @param request phone, password, client
   * @param clientIp the caller IP for throttling (NFR-S3)
   * @return the issued session
   */
  AuthTokensResponseDto login(LoginRequestDto request, String clientIp);

  /**
   * Rotates the refresh token; reuse of a revoked token revokes every live session of the user.
   *
   * @param request the refresh token
   * @return the new pair
   */
  AuthTokensResponseDto refresh(RefreshRequestDto request);

  /**
   * Revokes the given refresh token.
   *
   * @param request the refresh token
   */
  void logout(RefreshRequestDto request);

  /**
   * Sends a reset OTP when the phone exists; always behaves neutrally (NFR-S3).
   *
   * @param request the phone
   */
  void passwordResetStart(PasswordResetStartRequestDto request);

  /**
   * Verifies the reset OTP.
   *
   * @param request phone + code
   * @return a short-lived reset token
   */
  PasswordResetVerifyResponseDto passwordResetVerify(PasswordResetVerifyRequestDto request);

  /**
   * Sets the new password and revokes all sessions (AUTH-03).
   *
   * @param request reset token + new password
   */
  void passwordResetComplete(PasswordResetCompleteRequestDto request);
}
