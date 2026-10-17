package com.labby.backend.controller;

import com.labby.backend.dto.PromoValidationDto;
import com.labby.backend.dto.ValidatePromoRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.PromoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Promo validation before booking (growth-v1 Promos; UC-R-04 A1). */
@RestController
@RequestMapping("/api/v1/promos")
@Tag(name = "Promos", description = "Validate a code before booking")
@RequiredArgsConstructor
public class PromosController {

  private final PromoService promoService;

  /**
   * Checks a code for the given booking context.
   *
   * @param request code and context
   * @return 200 with the terms; 404 promo_not_found; 409 promo_window | promo_exhausted |
   *     promo_user_limit | promo_first_ride_only | promo_wrong_region | promo_wrong_service
   */
  @PostMapping("/validate")
  @Operation(summary = "Validate a promo code before booking (UC-R-04 A1)")
  public ResponseEntity<PromoValidationDto> validate(
      @Valid @RequestBody ValidatePromoRequestDto request) {
    return ResponseEntity.ok(promoService.validate(SecurityUtils.currentUserId(), request));
  }
}
