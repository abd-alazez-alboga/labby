package com.labby.backend.controller;

import com.labby.backend.dto.AccountFlagDto;
import com.labby.backend.dto.AccountFlagPageDto;
import com.labby.backend.dto.FlagResolveRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.AccountFlagService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The flagged-accounts queue (trust-v1.yaml AdminFlags: ADM-04, UC-A-16). */
@RestController
@RequestMapping("/api/v1/admin/flags")
@Tag(name = "AdminFlags", description = "Flagged accounts: low rating, metric warning, reports")
@RequiredArgsConstructor
public class AdminFlagsController {

  private final AccountFlagService accountFlagService;

  /**
   * The queue, oldest first.
   *
   * @param status open (default), actioned or dismissed
   * @param kind optional kind filter
   * @param userId optional user filter
   * @param page zero-based page
   * @param size page size (1..100)
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('users:view')")
  @Operation(summary = "Flagged-accounts queue (UC-A-16)")
  public ResponseEntity<AccountFlagPageDto> list(
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) UUID userId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        accountFlagService.queue(
            status, kind, userId, Math.max(0, page), Math.clamp(size, 1, 100)));
  }

  /**
   * Closes a flag as actioned or dismissed with a note (audited).
   *
   * @param flagId the flag
   * @param request resolution and note
   * @return 200 with the closed flag; 404 unknown; 409 already_resolved
   */
  @PostMapping("/{flagId}/resolve")
  @PreAuthorize("hasAuthority('users:suspend')")
  @Operation(summary = "Close a flag with a note")
  public ResponseEntity<AccountFlagDto> resolve(
      @PathVariable UUID flagId, @Valid @RequestBody FlagResolveRequestDto request) {
    return ResponseEntity.ok(
        accountFlagService.resolve(SecurityUtils.currentUserId(), flagId, request));
  }
}
