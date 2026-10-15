package com.labby.backend.controller;

import com.labby.backend.dto.AdminUserTrustDto;
import com.labby.backend.dto.SuspensionRequestDto;
import com.labby.backend.enums.RideParty;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminTrustService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The trust sections of the admin user profile (trust-v1.yaml AdminUsers: UC-A-13/14, USR-06). */
@RestController
@RequestMapping("/api/v1/admin/users/{userId}")
@Tag(name = "AdminUsers", description = "Trust profile; suspend / reactivate roles and accounts")
@RequiredArgsConstructor
public class AdminUserTrustController {

  private final AdminTrustService adminTrustService;

  /**
   * The user's trust profile: states, live averages, open flags, warnings, report history.
   *
   * @param userId the user
   * @return 200 with the profile; 404 unknown user
   */
  @GetMapping("/trust")
  @PreAuthorize("hasAuthority('users:view')")
  @Operation(summary = "Trust sections of the user profile (UC-A-13)")
  public ResponseEntity<AdminUserTrustDto> trust(@PathVariable UUID userId) {
    return ResponseEntity.ok(adminTrustService.trust(userId));
  }

  /**
   * Suspends one role with a mandatory note.
   *
   * @param userId the user
   * @param role rider or driver
   * @param request the note
   * @return 200 with the updated profile; 404; 409 already_suspended or admin_account
   */
  @PostMapping("/roles/{role}/suspend")
  @PreAuthorize("hasAuthority('users:suspend')")
  @Operation(summary = "Suspend one role (USR-06, UC-A-14)")
  public ResponseEntity<AdminUserTrustDto> suspendRole(
      @PathVariable UUID userId,
      @PathVariable String role,
      @Valid @RequestBody SuspensionRequestDto request) {
    return ResponseEntity.ok(
        adminTrustService.suspendRole(
            SecurityUtils.currentUserId(), userId, party(role), request.note()));
  }

  /**
   * Reactivates one role with a mandatory note.
   *
   * @param userId the user
   * @param role rider or driver
   * @param request the note
   * @return 200 with the updated profile; 404; 409 not_suspended or document_expired
   */
  @PostMapping("/roles/{role}/reactivate")
  @PreAuthorize("hasAuthority('users:suspend')")
  @Operation(summary = "Reactivate one role (USR-06, UC-A-14 A1)")
  public ResponseEntity<AdminUserTrustDto> reactivateRole(
      @PathVariable UUID userId,
      @PathVariable String role,
      @Valid @RequestBody SuspensionRequestDto request) {
    return ResponseEntity.ok(
        adminTrustService.reactivateRole(
            SecurityUtils.currentUserId(), userId, party(role), request.note()));
  }

  /**
   * Suspends the whole account — USR-06 "deactivate".
   *
   * @param userId the user
   * @param request the note
   * @return 200 with the updated profile; 404; 409 already_suspended, account_deleted or
   *     admin_account
   */
  @PostMapping("/suspend")
  @PreAuthorize("hasAuthority('users:suspend')")
  @Operation(summary = "Suspend the whole account (USR-06 deactivate)")
  public ResponseEntity<AdminUserTrustDto> suspendAccount(
      @PathVariable UUID userId, @Valid @RequestBody SuspensionRequestDto request) {
    return ResponseEntity.ok(
        adminTrustService.suspendAccount(SecurityUtils.currentUserId(), userId, request.note()));
  }

  /**
   * Reactivates a suspended account; role-level suspensions stay.
   *
   * @param userId the user
   * @param request the note
   * @return 200 with the updated profile; 404; 409 not_suspended
   */
  @PostMapping("/reactivate")
  @PreAuthorize("hasAuthority('users:suspend')")
  @Operation(summary = "Reactivate a suspended account")
  public ResponseEntity<AdminUserTrustDto> reactivateAccount(
      @PathVariable UUID userId, @Valid @RequestBody SuspensionRequestDto request) {
    return ResponseEntity.ok(
        adminTrustService.reactivateAccount(SecurityUtils.currentUserId(), userId, request.note()));
  }

  private static RideParty party(String role) {
    try {
      return RideParty.fromValue(role);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("role must be rider or driver");
    }
  }
}
