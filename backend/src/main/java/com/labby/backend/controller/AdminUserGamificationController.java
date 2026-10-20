package com.labby.backend.controller;

import com.labby.backend.dto.AdminUserGamificationDto;
import com.labby.backend.service.GamificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Badges and levels on the admin user profile (growth-v1 AdminGamification; UC-A-13, ADM-05). */
@RestController
@RequestMapping("/api/v1/admin/users/{userId}")
@Tag(name = "AdminGamification", description = "A user's badges and levels")
@RequiredArgsConstructor
public class AdminUserGamificationController {

  private final GamificationService gamificationService;

  /**
   * The user's rider and driver badges/level views (read-only, not audited).
   *
   * @param userId the user
   * @return 200 with the views; 404 unknown user
   */
  @GetMapping("/gamification")
  @PreAuthorize("hasAuthority('users:view')")
  @Operation(summary = "A user's badges and levels (UC-A-13)")
  public ResponseEntity<AdminUserGamificationDto> gamification(@PathVariable UUID userId) {
    return ResponseEntity.ok(gamificationService.forUser(userId));
  }
}
