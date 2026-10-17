package com.labby.backend.controller;

import com.labby.backend.dto.LoyaltyBalanceDto;
import com.labby.backend.dto.PointsTransactionPageDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.LoyaltyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Loyalty points (growth-v1 Loyalty; UC-R-19, GRW-04). */
@RestController
@RequestMapping("/api/v1/loyalty")
@Tag(name = "Loyalty", description = "Balance, history, redemption")
@RequiredArgsConstructor
public class LoyaltyController {

  private final LoyaltyService loyaltyService;

  /**
   * The caller's balance, level and the region's redemption rule.
   *
   * @param regionId the region whose rule to show
   * @return 200
   */
  @GetMapping
  @Operation(summary = "My points balance, level and redemption rule (UC-R-19)")
  public ResponseEntity<LoyaltyBalanceDto> balance(@RequestParam UUID regionId) {
    return ResponseEntity.ok(loyaltyService.balance(SecurityUtils.currentUserId(), regionId));
  }

  /**
   * The caller's points history.
   *
   * @param page zero-based page
   * @param size page size
   * @return 200 with one page
   */
  @GetMapping("/transactions")
  @Operation(summary = "My points history, newest first")
  public ResponseEntity<PointsTransactionPageDto> transactions(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        loyaltyService.transactions(
            SecurityUtils.currentUserId(), Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * Redeems points into a wallet credit.
   *
   * @param request region and points
   * @return 200; 403 account_suspended; 409 below_threshold | insufficient_points
   */
  @PostMapping("/redeem")
  @Operation(summary = "Redeem points into a wallet credit (UC-R-19)")
  public ResponseEntity<LoyaltyBalanceDto> redeem(@Valid @RequestBody RedeemRequest request) {
    return ResponseEntity.ok(
        loyaltyService.redeem(SecurityUtils.currentUserId(), request.regionId(), request.points()));
  }

  /** The redeem payload. */
  public record RedeemRequest(@NotNull UUID regionId, @NotNull @Min(1) Long points) {}
}
