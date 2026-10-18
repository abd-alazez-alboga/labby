package com.labby.backend.controller;

import com.labby.backend.dto.ReferralStatusDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ReferralService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Referrals (growth-v1 Referrals; UC-R-18, GRW-03). */
@RestController
@RequestMapping("/api/v1/referrals")
@Tag(name = "Referrals", description = "Share code, enter a code, referee statuses")
@RequiredArgsConstructor
public class ReferralsController {

  private final ReferralService referralService;

  /**
   * The caller's referral picture; the share code is created on first read.
   *
   * @param regionId the region whose reward amounts to include, or null for none
   * @return 200
   */
  @GetMapping("/me")
  @Operation(summary = "My referral code, referee statuses and region reward (UC-R-18)")
  public ResponseEntity<ReferralStatusDto> me(
      @RequestParam(name = "regionId", required = false) UUID regionId) {
    return ResponseEntity.ok(referralService.me(SecurityUtils.currentUserId(), regionId));
  }

  /**
   * Enters a referral code, once, before any completed ride.
   *
   * @param request the code
   * @return 200; 404 referral_code_not_found; 409 referral_already_entered | referral_self |
   *     referral_phone_used | referral_too_late
   */
  @PostMapping("/enter")
  @Operation(summary = "Enter a referral code (once, before the first ride)")
  public ResponseEntity<ReferralStatusDto> enter(@Valid @RequestBody EnterRequest request) {
    return ResponseEntity.ok(referralService.enter(SecurityUtils.currentUserId(), request.code()));
  }

  /** The enter payload. */
  public record EnterRequest(@NotBlank String code) {}
}
