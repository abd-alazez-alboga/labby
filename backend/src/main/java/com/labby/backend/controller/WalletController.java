package com.labby.backend.controller;

import com.labby.backend.dto.WalletTransactionPageDto;
import com.labby.backend.dto.WalletViewDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.WalletService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The account's wallet (money-v1.yaml, PAY-01, UC-R-17). */
@RestController
@RequestMapping("/api/v1/wallet")
@Tag(name = "Wallet", description = "Per-currency balances, dues and history")
@RequiredArgsConstructor
public class WalletController {

  private final WalletService walletService;

  /**
   * The caller's wallet.
   *
   * @return 200 with balances (possibly empty) and pending dues
   */
  @GetMapping
  @Operation(summary = "My wallet — balances and pending dues (UC-R-17)")
  public ResponseEntity<WalletViewDto> view() {
    return ResponseEntity.ok(walletService.view(SecurityUtils.currentUserId()));
  }

  /**
   * The caller's wallet history, newest first.
   *
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping("/transactions")
  @Operation(summary = "My wallet history — typed, newest first (UC-R-17)")
  public ResponseEntity<WalletTransactionPageDto> transactions(
      @RequestParam(required = false) String currency,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        walletService.transactions(
            SecurityUtils.currentUserId(), currency, Math.max(0, page), Math.clamp(size, 1, 100)));
  }
}
