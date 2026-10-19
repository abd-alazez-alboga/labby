package com.labby.backend.controller;

import com.labby.backend.dto.PatchPromoRequestDto;
import com.labby.backend.dto.PromoDetailDto;
import com.labby.backend.dto.PromoDto;
import com.labby.backend.dto.PromoPageDto;
import com.labby.backend.dto.SavePromoRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AdminGrowthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin promos (growth-v1 AdminPromos; UC-A-26), audited. */
@RestController
@RequestMapping("/api/v1/admin/promos")
@Tag(name = "AdminPromos", description = "Promo CRUD and redemption monitoring")
@RequiredArgsConstructor
public class AdminPromosController {

  private final AdminGrowthService adminGrowthService;

  /**
   * Creates a promo.
   *
   * @param request the promo
   * @return 201; 409 promo_code_taken; 422 fixed_needs_region | window_invalid
   */
  @PostMapping
  @PreAuthorize("hasAuthority('promos:manage')")
  @Operation(summary = "Create a promo (UC-A-26)")
  public ResponseEntity<PromoDto> create(@Valid @RequestBody SavePromoRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(adminGrowthService.createPromo(SecurityUtils.currentUserId(), request));
  }

  /**
   * Lists promos, newest first.
   *
   * @param regionId optional region filter
   * @param active optional active-flag filter
   * @param running optional: true = active AND the window contains now (M13 review W17)
   * @param page zero-based page
   * @param size page size
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('promos:view')")
  @Operation(summary = "List promos with redemption counters")
  public ResponseEntity<PromoPageDto> list(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) Boolean active,
      @RequestParam(required = false) Boolean running,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminGrowthService.listPromos(
            regionId, active, running, Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * One promo with its redemptions.
   *
   * @param promoId the promo
   * @param page redemptions page
   * @param size page size
   * @return 200; 404 unknown
   */
  @GetMapping("/{promoId}")
  @PreAuthorize("hasAuthority('promos:view')")
  @Operation(summary = "One promo with its redemptions")
  public ResponseEntity<PromoDetailDto> detail(
      @PathVariable UUID promoId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminGrowthService.promoDetail(promoId, Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * Edits or deactivates a promo (code, type and value are fixed after creation).
   *
   * @param promoId the promo
   * @param request the changes
   * @return 200; 404 unknown; 422 window_invalid
   */
  @PatchMapping("/{promoId}")
  @PreAuthorize("hasAuthority('promos:manage')")
  @Operation(summary = "Edit or deactivate a promo")
  public ResponseEntity<PromoDto> patch(
      @PathVariable UUID promoId, @Valid @RequestBody PatchPromoRequestDto request) {
    return ResponseEntity.ok(
        adminGrowthService.patchPromo(SecurityUtils.currentUserId(), promoId, request));
  }
}
