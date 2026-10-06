package com.labby.backend.controller;

import com.labby.backend.dto.VehicleSwitchRequestDto;
import com.labby.backend.dto.VehicleWithDocumentsDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DriverVehicleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The driver's own vehicles and vehicle switch (UC-D-18) per onboarding-v1.yaml. */
@RestController
@RequestMapping("/api/v1/driver/vehicles")
@Tag(name = "DriverVehicles", description = "Own vehicles and vehicle switch")
@RequiredArgsConstructor
public class DriverVehiclesController {

  private final DriverVehicleService driverVehicleService;

  /**
   * Lists the own vehicles with their documents, newest first.
   *
   * @return 200 with the vehicles
   */
  @GetMapping
  @Operation(summary = "List the own vehicles with their documents")
  public ResponseEntity<List<VehicleWithDocumentsDto>> listVehicles() {
    return ResponseEntity.ok(driverVehicleService.listOwnVehicles(SecurityUtils.currentUserId()));
  }

  /**
   * Submits a vehicle switch; the current vehicle stays active until it is approved.
   *
   * @param request the new vehicle + registration + insurance
   * @return 201 with the pending vehicle
   */
  @PostMapping
  @Operation(summary = "Submit a vehicle switch")
  public ResponseEntity<VehicleWithDocumentsDto> submitSwitch(
      @RequestBody VehicleSwitchRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(driverVehicleService.submitSwitch(SecurityUtils.currentUserId(), request));
  }
}
