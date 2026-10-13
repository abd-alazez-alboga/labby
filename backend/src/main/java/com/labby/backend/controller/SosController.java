package com.labby.backend.controller;

import com.labby.backend.dto.SosEventDto;
import com.labby.backend.dto.SosRequestDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SosService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The parties' SOS trigger (comms-v1.yaml Sos, SAFE-01, UC-S-16). */
@RestController
@RequestMapping("/api/v1/rides")
@Tag(name = "Sos", description = "Record an SOS event and alert support admins")
@RequiredArgsConstructor
public class SosController {

  private final SosService sosService;

  /**
   * Records an SOS event and queues the admin alert fan-out. Fired silently alongside the
   * client-side dialer; repeat taps create repeat events.
   *
   * @param rideId the ride
   * @param request the device position and moment
   * @return 201 with the permanent event; 403 not a party; 409 ride_not_active
   */
  @PostMapping("/{rideId}/sos")
  @Operation(summary = "Record an SOS event and alert support admins (SAFE-01)")
  public ResponseEntity<SosEventDto> trigger(
      @PathVariable UUID rideId, @Valid @RequestBody SosRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(sosService.trigger(SecurityUtils.currentUserId(), rideId, request));
  }
}
