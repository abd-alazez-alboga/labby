package com.labby.backend.controller;

import com.labby.backend.dto.RiderPreferencesDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.RiderPreferenceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Rider comfort preferences + matching toggle (UC-R-02/03) per rides-v1.yaml. */
@RestController
@RequestMapping("/api/v1/rider/preferences")
@Tag(name = "RiderPreferences", description = "Comfort preferences and matching toggle")
@RequiredArgsConstructor
public class RiderPreferencesController {

  private final RiderPreferenceService riderPreferenceService;

  /**
   * The rider's preferences (defaults when never set).
   *
   * @return 200 with the preferences
   */
  @GetMapping
  @Operation(summary = "Comfort preferences + matching toggle")
  public ResponseEntity<RiderPreferencesDto> get() {
    return ResponseEntity.ok(riderPreferenceService.get(SecurityUtils.currentUserId()));
  }

  /**
   * Replaces the preferences.
   *
   * @param request the new values
   * @return 200 with the saved preferences
   */
  @PutMapping
  @Operation(summary = "Replace preferences (applies to every later booking)")
  public ResponseEntity<RiderPreferencesDto> replace(
      @Valid @RequestBody RiderPreferencesDto request) {
    return ResponseEntity.ok(
        riderPreferenceService.replace(SecurityUtils.currentUserId(), request));
  }
}
