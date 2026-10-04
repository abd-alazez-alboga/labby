package com.labby.backend.controller;

import com.labby.backend.dto.ChangePasswordRequestDto;
import com.labby.backend.dto.DeleteAccountRequestDto;
import com.labby.backend.dto.PhoneChangeStartRequestDto;
import com.labby.backend.dto.PhoneChangeVerifyRequestDto;
import com.labby.backend.dto.UpdateProfileRequestDto;
import com.labby.backend.dto.UserPhotoDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.MeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Own-account endpoints per the M2 contract (backend/docs/api/auth-v1.yaml). */
@RestController
@RequestMapping("/api/v1/users/me")
@Tag(name = "Me", description = "Own profile and account management")
@RequiredArgsConstructor
public class MeController {

  private final MeService meService;

  /**
   * Returns the own profile.
   *
   * @return 200 with the profile
   */
  @GetMapping
  @Operation(summary = "Get the own profile")
  public ResponseEntity<UserProfileDto> getProfile() {
    return ResponseEntity.ok(meService.getProfile(SecurityUtils.currentUserId()));
  }

  /**
   * Updates name and language.
   *
   * @param request name + language
   * @return 200 with the updated profile
   */
  @PutMapping
  @Operation(summary = "Update name and language")
  public ResponseEntity<UserProfileDto> updateProfile(
      @Valid @RequestBody UpdateProfileRequestDto request) {
    return ResponseEntity.ok(meService.updateProfile(SecurityUtils.currentUserId(), request));
  }

  /**
   * Soft-deletes the own account (2FA).
   *
   * @param request the 2FA OTP
   * @return 204
   */
  @DeleteMapping
  @Operation(summary = "Soft-delete the own account (2FA)")
  public ResponseEntity<Void> deleteAccount(@Valid @RequestBody DeleteAccountRequestDto request) {
    meService.deleteAccount(SecurityUtils.currentUserId(), request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Changes the password (2FA; other sessions revoked).
   *
   * @param request current password + OTP + new password
   * @return 204
   */
  @PutMapping("/password")
  @Operation(summary = "Change password (2FA)")
  public ResponseEntity<Void> changePassword(@Valid @RequestBody ChangePasswordRequestDto request) {
    meService.changePassword(
        SecurityUtils.currentUserId(), SecurityUtils.currentSessionId().orElse(null), request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Requests a 2FA OTP for a sensitive operation.
   *
   * @return 204
   */
  @PostMapping("/2fa/request")
  @Operation(summary = "Request a 2FA OTP for a sensitive operation")
  public ResponseEntity<Void> requestTwoFactorCode() {
    meService.requestTwoFactorCode(SecurityUtils.currentUserId());
    return ResponseEntity.noContent().build();
  }

  /**
   * Phone change step 1: declare the new phone.
   *
   * @param request the new phone
   * @return 204
   */
  @PostMapping("/phone-change/start")
  @Operation(summary = "Phone change step 1: declare the new phone")
  public ResponseEntity<Void> phoneChangeStart(
      @Valid @RequestBody PhoneChangeStartRequestDto request) {
    meService.phoneChangeStart(SecurityUtils.currentUserId(), request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Phone change step 2: prove the current phone.
   *
   * @param request the code sent to the current phone
   * @return 204
   */
  @PostMapping("/phone-change/verify-current")
  @Operation(summary = "Phone change step 2: prove the current phone")
  public ResponseEntity<Void> phoneChangeVerifyCurrent(
      @Valid @RequestBody PhoneChangeVerifyRequestDto request) {
    meService.phoneChangeVerifyCurrent(SecurityUtils.currentUserId(), request);
    return ResponseEntity.noContent().build();
  }

  /**
   * Phone change step 3: prove the new phone.
   *
   * @param request the code sent to the new phone
   * @return 200 with the updated profile
   */
  @PostMapping("/phone-change/complete")
  @Operation(summary = "Phone change step 3: prove the new phone")
  public ResponseEntity<UserProfileDto> phoneChangeComplete(
      @Valid @RequestBody PhoneChangeVerifyRequestDto request) {
    return ResponseEntity.ok(meService.phoneChangeComplete(SecurityUtils.currentUserId(), request));
  }

  /**
   * Uploads/replaces the profile photo.
   *
   * @param file the multipart image
   * @return 200 with the updated profile
   */
  @PutMapping(path = "/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(summary = "Upload/replace the profile photo")
  public ResponseEntity<UserProfileDto> updatePhoto(@RequestParam("file") MultipartFile file) {
    return ResponseEntity.ok(meService.updatePhoto(SecurityUtils.currentUserId(), file));
  }

  /**
   * Serves the own profile photo (private, owner-only in M2 — NFR-S2).
   *
   * @return 200 with the image bytes
   */
  @GetMapping("/photo")
  @Operation(summary = "Get the own profile photo")
  public ResponseEntity<byte[]> getPhoto() {
    UserPhotoDto photo = meService.getPhoto(SecurityUtils.currentUserId());
    return ResponseEntity.ok().header("Content-Type", photo.contentType()).body(photo.content());
  }
}
