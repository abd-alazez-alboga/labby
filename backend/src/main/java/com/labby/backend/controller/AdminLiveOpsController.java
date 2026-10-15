package com.labby.backend.controller;

import com.labby.backend.dto.LiveOpsDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.LiveOpsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The admin live ops map feed (comms-v1.yaml AdminLiveOps, ADM-03, UC-A-19). */
@RestController
@RequestMapping("/api/v1/admin/regions")
@Tag(name = "AdminLiveOps", description = "Live ops map snapshot per region")
@RequiredArgsConstructor
public class AdminLiveOpsController {

  private final LiveOpsService liveOpsService;

  /**
   * One polled snapshot: fresh online drivers, active rides, the surge overlay and open SOS pins.
   * The SOS callers' phones are contact access (UC-A-20): served only to {@code support:handle}
   * holders, null for everyone else.
   *
   * @param regionId the region
   * @param authentication the caller
   * @return 200 with the snapshot; 404 unknown region
   */
  @GetMapping("/{regionId}/live-ops")
  @PreAuthorize("hasAuthority('rides:view')")
  @Operation(summary = "Live ops map snapshot (ADM-03)")
  public ResponseEntity<LiveOpsDto> liveOps(
      @PathVariable UUID regionId, Authentication authentication) {
    LiveOpsDto snapshot = liveOpsService.snapshot(regionId);
    return ResponseEntity.ok(
        SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue())
            ? snapshot
            : snapshot.withoutSosPhones());
  }
}
