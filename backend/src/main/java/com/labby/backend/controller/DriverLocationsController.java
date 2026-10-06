package com.labby.backend.controller;

import com.labby.backend.dto.LocationBatchRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverLocationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** REST fallback for driver location samples (TRK-01) per realtime-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/locations")
@Tag(name = "Locations", description = "GPS sample ingestion (REST fallback)")
@RequiredArgsConstructor
public class DriverLocationsController {

  private final DriverLocationService driverLocationService;

  /**
   * Accepts a batch of samples; the newest becomes the current position.
   *
   * @param request 1..20 samples
   * @return 202; 400 for an invalid sample; 409 when offline or not a driver
   */
  @PostMapping
  @Operation(summary = "REST fallback for location samples (batch)")
  public ResponseEntity<Void> ingest(@Valid @RequestBody LocationBatchRequestDto request) {
    driverLocationService.ingestBatch(SecurityUtils.currentUserId(), request.samples());
    return ResponseEntity.accepted().build();
  }
}
