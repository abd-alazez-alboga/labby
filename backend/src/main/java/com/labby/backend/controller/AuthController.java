package com.labby.backend.controller;

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
import com.labby.backend.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Auth endpoints per the M2 contract (backend/docs/api/auth-v1.yaml). */
@RestController
@RequestMapping("/api/v1/auth")
@Tag(name = "Auth", description = "Registration, login, sessions, password reset")
@RequiredArgsConstructor
public class AuthController {

  private final AuthService authService;

  /**
   * Requests a registration OTP.
   *
   * @param request the phone
   * @return 204 when sent
   */
  @PostMapping("/register/start")
  @Operation(summary = "Request a registration OTP for a phone number")
  public ResponseEntity<Void> registerStart(@Valid @RequestBody RegisterStartRequestDto request) {
    authService.registerStart(request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Verifies the registration OTP.
   *
   * @param request phone + code
   * @return 200 with mode and optional registration token
   */
  @PostMapping("/register/verify")
  @Operation(summary = "Verify the registration OTP")
  public ResponseEntity<RegisterVerifyResponseDto> registerVerify(
      @Valid @RequestBody RegisterVerifyRequestDto request) {
    return ResponseEntity.ok(authService.registerVerify(request));
  }

  /**
   * Completes a new registration.
   *
   * @param request registration token + password + name
   * @return 201 with the issued session
   */
  @PostMapping("/register/complete")
  @Operation(summary = "Complete a new registration")
  public ResponseEntity<AuthTokensResponseDto> registerComplete(
      @Valid @RequestBody RegisterCompleteRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(authService.registerComplete(request));
  }

  /**
   * Logs in with phone + password.
   *
   * @param request phone, password, client
   * @param httpRequest used for the caller IP (throttling)
   * @return 200 with the issued session
   */
  @PostMapping("/login")
  @Operation(summary = "Log in with phone + password")
  public ResponseEntity<AuthTokensResponseDto> login(
      @Valid @RequestBody LoginRequestDto request, HttpServletRequest httpRequest) {
    return ResponseEntity.ok(authService.login(request, httpRequest.getRemoteAddr()));
  }

  /**
   * Rotates the refresh token.
   *
   * @param request the refresh token
   * @return 200 with the new pair
   */
  @PostMapping("/refresh")
  @Operation(summary = "Rotate the refresh token")
  public ResponseEntity<AuthTokensResponseDto> refresh(
      @Valid @RequestBody RefreshRequestDto request) {
    return ResponseEntity.ok(authService.refresh(request));
  }

  /**
   * Invalidates the current session.
   *
   * @param request the refresh token
   * @return 204
   */
  @PostMapping("/logout")
  @Operation(summary = "Invalidate the current session")
  public ResponseEntity<Void> logout(@Valid @RequestBody RefreshRequestDto request) {
    authService.logout(request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Requests a password-reset OTP; always neutral.
   *
   * @param request the phone
   * @return 204 always
   */
  @PostMapping("/password-reset/start")
  @Operation(summary = "Request a password-reset OTP")
  public ResponseEntity<Void> passwordResetStart(
      @Valid @RequestBody PasswordResetStartRequestDto request) {
    authService.passwordResetStart(request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Verifies the reset OTP.
   *
   * @param request phone + code
   * @return 200 with the reset token
   */
  @PostMapping("/password-reset/verify")
  @Operation(summary = "Verify the reset OTP")
  public ResponseEntity<PasswordResetVerifyResponseDto> passwordResetVerify(
      @Valid @RequestBody PasswordResetVerifyRequestDto request) {
    return ResponseEntity.ok(authService.passwordResetVerify(request));
  }

  /**
   * Sets the new password after a verified reset.
   *
   * @param request reset token + new password
   * @return 204
   */
  @PostMapping("/password-reset/complete")
  @Operation(summary = "Set a new password after a verified reset")
  public ResponseEntity<Void> passwordResetComplete(
      @Valid @RequestBody PasswordResetCompleteRequestDto request) {
    authService.passwordResetComplete(request);
    return ResponseEntity.noContent().build();
  }
}
