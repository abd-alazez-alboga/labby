package com.labby.backend.controller;

import com.labby.backend.dto.ChallengeDetailDto;
import com.labby.backend.dto.ChallengeDto;
import com.labby.backend.dto.ChallengePageDto;
import com.labby.backend.dto.SaveChallengeRequestDto;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin challenges (growth-v1 AdminChallenges; UC-A-28), audited. */
@RestController
@RequestMapping("/api/v1/admin/challenges")
@Tag(name = "AdminChallenges", description = "Challenge CRUD, participation, early end")
@RequiredArgsConstructor
public class AdminChallengesController {

  private final AdminGrowthService adminGrowthService;

  /**
   * Creates a challenge.
   *
   * @param request the challenge
   * @return 201; 422 window_invalid
   */
  @PostMapping
  @PreAuthorize("hasAuthority('challenges:manage')")
  @Operation(summary = "Create a challenge (UC-A-28)")
  public ResponseEntity<ChallengeDto> create(@Valid @RequestBody SaveChallengeRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(adminGrowthService.createChallenge(SecurityUtils.currentUserId(), request));
  }

  /**
   * Lists challenges, newest first.
   *
   * @param regionId optional region filter
   * @param page zero-based page
   * @param size page size
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('challenges:view')")
  @Operation(summary = "List challenges with participation counters")
  public ResponseEntity<ChallengePageDto> list(
      @RequestParam(required = false) UUID regionId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminGrowthService.listChallenges(regionId, Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * One challenge with its participation.
   *
   * @param challengeId the challenge
   * @param page participation page
   * @param size page size
   * @return 200; 404 unknown
   */
  @GetMapping("/{challengeId}")
  @PreAuthorize("hasAuthority('challenges:view')")
  @Operation(summary = "One challenge with its participation")
  public ResponseEntity<ChallengeDetailDto> detail(
      @PathVariable UUID challengeId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        adminGrowthService.challengeDetail(
            challengeId, Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * Ends a challenge early; completions already made keep their reward.
   *
   * @param challengeId the challenge
   * @return 200; 409 already_ended
   */
  @PostMapping("/{challengeId}/end")
  @PreAuthorize("hasAuthority('challenges:manage')")
  @Operation(summary = "End a challenge early")
  public ResponseEntity<ChallengeDto> end(@PathVariable UUID challengeId) {
    return ResponseEntity.ok(
        adminGrowthService.endChallenge(SecurityUtils.currentUserId(), challengeId));
  }
}
