package com.labby.backend.controller;

import com.labby.backend.dto.DriverLedgerViewDto;
import com.labby.backend.dto.SettlementRequestDto;
import com.labby.backend.dto.SettlementResponseDto;
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

/** The driver ledger and settlement recording (money-v1.yaml; COM-04, UC-A-27). */
@RestController
@RequestMapping("/api/v1/admin/drivers/{driverUserId}")
@Tag(name = "AdminSettlements", description = "Driver ledgers and settlements")
@RequiredArgsConstructor
public class AdminSettlementsController {

  private final AdminMoneyService adminMoneyService;

  /**
   * A driver's ledger, newest first.
   *
   * @param driverUserId the driver
   * @param currency optional currency filter
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with balances + one page; 404 not a driver
   */
  @GetMapping("/ledger")
  @PreAuthorize("hasAuthority('settlements:view')")
  @Operation(summary = "A driver's ledger — balances + typed entries (UC-A-27)")
  public ResponseEntity<DriverLedgerViewDto> ledger(
      @PathVariable UUID driverUserId,
      @RequestParam(required = false) String currency,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminMoneyService.ledger(
            driverUserId, currency, Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  /**
   * Records a settlement (COM-04) — immutable, audited; lifting the balance above the floor
   * unblocks offers and notifies the driver.
   *
   * @param driverUserId the driver
   * @param request the settlement
   * @return 201 with the new balance and floor status; 400 invalid; 404 not a driver
   */
  @PostMapping("/settlements")
  @PreAuthorize("hasAuthority('settlements:record')")
  @Operation(summary = "Record a settlement (UC-A-27)")
  public ResponseEntity<SettlementResponseDto> settle(
      @PathVariable UUID driverUserId, @Valid @RequestBody SettlementRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(adminMoneyService.settle(SecurityUtils.currentUserId(), driverUserId, request));
  }
}
