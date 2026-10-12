package com.labby.backend.controller;

import com.labby.backend.dto.WalletCreditRequestDto;
import com.labby.backend.dto.WalletTransactionDto;
import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminMoneyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin wallet inspection and credits (money-v1.yaml; UC-A-13/15, PAY-03). */
@RestController
@RequestMapping("/api/v1/admin/users/{userId}/wallet")
@Tag(name = "AdminWallets", description = "Wallet inspection, grants and refunds")
@RequiredArgsConstructor
public class AdminWalletsController {

  private final AdminMoneyService adminMoneyService;

  /**
   * A user's wallet.
   *
   * @param userId the user
   * @return 200 with balances and pending dues; 404 unknown user
   */
  @GetMapping
  @PreAuthorize("hasAuthority('wallets:view')")
  @Operation(summary = "Inspect a user's wallet (UC-A-13)")
  public ResponseEntity<WalletViewDto> wallet(@PathVariable UUID userId) {
    return ResponseEntity.ok(adminMoneyService.wallet(userId));
  }

  /**
   * A user's wallet history, newest first.
   *
   * @param userId the user
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page; 404 unknown user
   */
  @GetMapping("/transactions")
  @PreAuthorize("hasAuthority('wallets:view')")
  @Operation(summary = "A user's wallet history (UC-A-13)")
  public ResponseEntity<WalletTransactionPageDto> transactions(
      @PathVariable UUID userId,
      @RequestParam(required = false) String currency,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminMoneyService.walletTransactions(
            userId, currency, Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  /**
   * Grants credit or issues a refund (PAY-03) — audited, the user notified.
   *
   * @param userId the user
   * @param request the credit
   * @return 201 with the entry; 400 invalid amount / currency / ride link; 404 unknown user
   */
  @PostMapping("/credits")
  @PreAuthorize("hasAuthority('wallets:manage')")
  @Operation(summary = "Grant wallet credit / issue a refund (UC-A-15)")
  public ResponseEntity<WalletTransactionDto> credit(
      @PathVariable UUID userId, @Valid @RequestBody WalletCreditRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(adminMoneyService.credit(SecurityUtils.currentUserId(), userId, request));
  }
}
