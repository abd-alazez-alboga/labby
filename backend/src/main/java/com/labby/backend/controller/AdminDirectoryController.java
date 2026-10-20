package com.labby.backend.controller;

import com.labby.backend.dto.AdminDriverDto;
import com.labby.backend.dto.AdminDriverPageDto;
import com.labby.backend.dto.AdminTransactionPageDto;
import com.labby.backend.dto.AdminUserDto;
import com.labby.backend.dto.AdminUserPageDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminDirectoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The admin users / drivers / transactions lists (analytics-v1.yaml AdminDirectory, M15 ruling Q1).
 * Phones are contact access (UC-A-20): served only to {@code support:handle} holders.
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "AdminDirectory", description = "Users, drivers and transactions lists")
@RequiredArgsConstructor
public class AdminDirectoryController {

  private final AdminDirectoryService adminDirectoryService;

  /**
   * Users, newest first.
   *
   * @param role holds this role
   * @param from createdAt lower bound (inclusive)
   * @param to createdAt upper bound (exclusive)
   * @param q search: a user id, part of the name, or a phone in any format
   * @param page zero-based page
   * @param size page size (1..100)
   * @param authentication the caller
   * @return 200 with one page
   */
  @GetMapping("/users")
  @PreAuthorize("hasAuthority('users:view')")
  @Operation(summary = "User list")
  public ResponseEntity<AdminUserPageDto> users(
      @RequestParam(required = false) String role,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      Authentication authentication) {
    AdminUserPageDto result =
        adminDirectoryService.users(
            AdminListFilters.users(role, from, to, q), Math.max(0, page), Math.clamp(size, 1, 100));
    if (contactAccess(authentication)) {
      return ResponseEntity.ok(result);
    }
    return ResponseEntity.ok(
        new AdminUserPageDto(
            result.items().stream().map(AdminUserDto::withoutPhone).toList(),
            result.page(),
            result.size(),
            result.totalItems()));
  }

  /**
   * Users with a driver application, newest account first.
   *
   * @param regionId the active vehicle serves this region
   * @param status the application status
   * @param online the online flag
   * @param page zero-based page
   * @param size page size (1..100)
   * @param authentication the caller
   * @return 200 with one page
   */
  @GetMapping("/drivers")
  @PreAuthorize("hasAuthority('users:view')")
  @Operation(summary = "Driver list")
  public ResponseEntity<AdminDriverPageDto> drivers(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Boolean online,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      Authentication authentication) {
    AdminDriverPageDto result =
        adminDirectoryService.drivers(
            AdminListFilters.drivers(regionId, status, online),
            Math.max(0, page),
            Math.clamp(size, 1, 100));
    if (contactAccess(authentication)) {
      return ResponseEntity.ok(result);
    }
    return ResponseEntity.ok(
        new AdminDriverPageDto(
            result.items().stream().map(AdminDriverDto::withoutPhone).toList(),
            result.page(),
            result.size(),
            result.totalItems()));
  }

  /**
   * Wallet transactions + driver ledger entries, newest first.
   *
   * @param source wallet or driver_ledger
   * @param type a wallet or ledger type value
   * @param currency the currency
   * @param userId the wallet owner / ledger driver
   * @param from createdAt lower bound (inclusive)
   * @param to createdAt upper bound (exclusive)
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping("/transactions")
  @PreAuthorize("hasAuthority('wallets:view') and hasAuthority('settlements:view')")
  @Operation(summary = "Wallet transactions and driver ledger entries")
  public ResponseEntity<AdminTransactionPageDto> transactions(
      @RequestParam(required = false) String source,
      @RequestParam(required = false) String type,
      @RequestParam(required = false) String currency,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminDirectoryService.transactions(
            AdminListFilters.transactions(source, type, currency, userId, from, to),
            Math.max(0, page),
            Math.clamp(size, 1, 100)));
  }

  private static boolean contactAccess(Authentication authentication) {
    return SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue());
  }
}
