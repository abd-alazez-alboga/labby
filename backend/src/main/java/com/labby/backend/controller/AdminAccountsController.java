package com.labby.backend.controller;

import com.labby.backend.dto.AdminAccountDto;
import com.labby.backend.dto.ChangeAdminRoleRequestDto;
import com.labby.backend.dto.CreateAdminRequestDto;
import com.labby.backend.dto.CreateAdminResponseDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminAccountService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin account management per the M3 contract (backend/docs/api/rbac-v1.yaml). Every endpoint
 * enforces its contract permission server-side (RBAC-03).
 */
@RestController
@RequestMapping("/api/v1/admin/admins")
@Tag(name = "Admins", description = "Admin account management (Super Admin)")
@RequiredArgsConstructor
public class AdminAccountsController {

  private final AdminAccountService adminAccountService;

  /**
   * Lists admin accounts.
   *
   * @return 200 with all admin accounts
   */
  @GetMapping
  @PreAuthorize("hasAuthority('admins:view')")
  @Operation(summary = "List admin accounts")
  public ResponseEntity<List<AdminAccountDto>> listAdmins() {
    return ResponseEntity.ok(adminAccountService.listAdmins());
  }

  /**
   * Creates an admin account (UC-A-01).
   *
   * @param request phone, name, roleId
   * @return 201 with the outcome
   */
  @PostMapping
  @PreAuthorize("hasAuthority('admins:manage')")
  @Operation(summary = "Create an admin account")
  public ResponseEntity<CreateAdminResponseDto> createAdmin(
      @Valid @RequestBody CreateAdminRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(adminAccountService.createAdmin(SecurityUtils.currentUserId(), request));
  }

  /**
   * Changes an admin's role (UC-A-02).
   *
   * @param userId the target admin's user id
   * @param request the new role
   * @return 200 with the updated admin
   */
  @PutMapping("/{userId}/role")
  @PreAuthorize("hasAuthority('admins:manage')")
  @Operation(summary = "Change an admin's role")
  public ResponseEntity<AdminAccountDto> changeRole(
      @PathVariable UUID userId, @Valid @RequestBody ChangeAdminRoleRequestDto request) {
    return ResponseEntity.ok(
        adminAccountService.changeRole(SecurityUtils.currentUserId(), userId, request));
  }

  /**
   * Deactivates an admin (UC-A-02).
   *
   * @param userId the target admin's user id
   * @return 200 with the updated admin
   */
  @PostMapping("/{userId}/deactivate")
  @PreAuthorize("hasAuthority('admins:manage')")
  @Operation(summary = "Deactivate an admin")
  public ResponseEntity<AdminAccountDto> deactivate(@PathVariable UUID userId) {
    return ResponseEntity.ok(adminAccountService.deactivate(SecurityUtils.currentUserId(), userId));
  }

  /**
   * Reactivates a deactivated admin (UC-A-02).
   *
   * @param userId the target admin's user id
   * @return 200 with the updated admin
   */
  @PostMapping("/{userId}/reactivate")
  @PreAuthorize("hasAuthority('admins:manage')")
  @Operation(summary = "Reactivate a deactivated admin")
  public ResponseEntity<AdminAccountDto> reactivate(@PathVariable UUID userId) {
    return ResponseEntity.ok(adminAccountService.reactivate(SecurityUtils.currentUserId(), userId));
  }
}
