package com.labby.backend.controller;

import com.labby.backend.dto.ChallengeViewDto;
import com.labby.backend.dto.GamificationViewDto;
import com.labby.backend.enums.RideParty;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.GamificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Badges, levels and the user-side challenge list (growth-v1 Gamification; UC-S-23/24). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Gamification", description = "Badges, levels, challenges")
@RequiredArgsConstructor
public class GamificationController {

  private final GamificationService gamificationService;

  /**
   * The caller's badges and level as one role.
   *
   * @param as rider or driver
   * @return 200
   */
  @GetMapping("/gamification/me")
  @Operation(summary = "My badges and level (UC-S-23/24)")
  public ResponseEntity<GamificationViewDto> me(@RequestParam String as) {
    return ResponseEntity.ok(gamificationService.me(SecurityUtils.currentUserId(), party(as)));
  }

  /**
   * The region + role's challenges with the caller's progress.
   *
   * @param regionId the region
   * @param as rider or driver
   * @return 200, running first, then upcoming, then recently ended
   */
  @GetMapping("/challenges")
  @Operation(summary = "Challenges of my region and role, with my progress (GAME-02)")
  public ResponseEntity<List<ChallengeViewDto>> challenges(
      @RequestParam UUID regionId, @RequestParam String as) {
    return ResponseEntity.ok(
        gamificationService.challenges(SecurityUtils.currentUserId(), regionId, party(as)));
  }

  /** {@code as} must be rider or driver — anything else is the caller's mistake (400). */
  private static RideParty party(String as) {
    try {
      return RideParty.fromValue(as);
    } catch (IllegalArgumentException ex) {
      throw new InvalidRequestException("as must be rider or driver");
    }
  }
}
