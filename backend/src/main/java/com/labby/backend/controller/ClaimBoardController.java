package com.labby.backend.controller;

import com.labby.backend.dto.ClaimBoardPageDto;
import com.labby.backend.dto.ClaimReleaseRequestDto;
import com.labby.backend.dto.RideDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ClaimBoardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The scheduled-ride claim board and claims (RIDE-S2, UC-D-11/12) per scheduled-shared-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver")
@Tag(name = "ClaimBoard", description = "Claim board, claim, release, claimed rides")
@RequiredArgsConstructor
public class ClaimBoardController {

  private final ClaimBoardService claimBoardService;

  /**
   * Open scheduled rides the driver may claim.
   *
   * @param page zero-based page
   * @param size page size (1..50)
   * @return 200 with one page, soonest first
   */
  @GetMapping("/claim-board")
  @Operation(summary = "Open scheduled rides the driver may claim (UC-D-11)")
  public ResponseEntity<ClaimBoardPageDto> board(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        claimBoardService.board(
            SecurityUtils.currentUserId(), Math.max(0, page), Math.clamp(size, 1, 50)));
  }

  /**
   * The driver's claimed, not yet converted rides.
   *
   * @return 200 with the rides, soonest first
   */
  @GetMapping("/scheduled-rides")
  @Operation(summary = "The driver's claims (UC-D-12)")
  public ResponseEntity<List<RideDto>> claims() {
    return ResponseEntity.ok(claimBoardService.claims(SecurityUtils.currentUserId()));
  }

  /**
   * Claims a board entry.
   *
   * @param rideId the ride
   * @return 200 with the driver view; 409 already_claimed / claim_closed; 422 not_eligible
   */
  @PostMapping("/scheduled-rides/{rideId}/claim")
  @Operation(summary = "Claim a board entry (RIDE-S2)")
  public ResponseEntity<RideDto> claim(@PathVariable UUID rideId) {
    return ResponseEntity.ok(claimBoardService.claim(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * Gives a claim back before conversion.
   *
   * @param rideId the ride
   * @param request the reason
   * @return 204; 403 not the claimer; 409 illegal_state
   */
  @PostMapping("/scheduled-rides/{rideId}/release")
  @Operation(summary = "Release a claim before conversion (UC-D-12 E1)")
  public ResponseEntity<Void> release(
      @PathVariable UUID rideId, @Valid @RequestBody ClaimReleaseRequestDto request) {
    claimBoardService.release(SecurityUtils.currentUserId(), rideId, request);
    return ResponseEntity.noContent().build();
  }
}
