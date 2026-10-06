package com.labby.backend.controller;

import com.labby.backend.dto.ApplicationResubmitRequestDto;
import com.labby.backend.dto.ApplicationSubmitRequestDto;
import com.labby.backend.dto.DriverApplicationDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverApplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The applicant's own driver application (UC-D-01..03) per onboarding-v1.yaml. Bodies are validated
 * by the service so errors are keyed per item ({@code documents[insurance].expiresOn}).
 */
@RestController
@RequestMapping("/api/v1/driver/application")
@Tag(name = "DriverApplication", description = "Apply to drive and track the application")
@RequiredArgsConstructor
public class DriverApplicationController {

  private final DriverApplicationService driverApplicationService;

  /**
   * Reads the own application with its stage history.
   *
   * @return 200 with the application
   */
  @GetMapping
  @Operation(summary = "Read the own driver application with stage history")
  public ResponseEntity<DriverApplicationDto> getApplication() {
    return ResponseEntity.ok(
        driverApplicationService.getOwnApplication(SecurityUtils.currentUserId()));
  }

  /**
   * Submits an application (or reapplies in full after rejection).
   *
   * @param request four documents + vehicle
   * @return 201 with the submitted application
   */
  @PostMapping
  @Operation(summary = "Submit (or, after rejection, resubmit in full) a driver application")
  public ResponseEntity<DriverApplicationDto> submit(
      @RequestBody ApplicationSubmitRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(driverApplicationService.submit(SecurityUtils.currentUserId(), request));
  }

  /**
   * Resubmits exactly the flagged items.
   *
   * @param request the flagged items
   * @return 200 with the application back under review
   */
  @PostMapping("/resubmit")
  @Operation(summary = "Resubmit only the flagged items")
  public ResponseEntity<DriverApplicationDto> resubmit(
      @RequestBody ApplicationResubmitRequestDto request) {
    return ResponseEntity.ok(
        driverApplicationService.resubmit(SecurityUtils.currentUserId(), request));
  }
}
