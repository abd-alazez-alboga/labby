package com.labby.backend.controller;

import com.labby.backend.dto.DeviceRegistrationDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.DeviceTokenService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** FCM device-token registration (ES-03) per realtime-v1.yaml. */
@RestController
@RequestMapping("/api/v1/devices")
@Tag(name = "Devices", description = "Push token registration")
@RequiredArgsConstructor
public class DevicesController {

  private final DeviceTokenService deviceTokenService;

  /**
   * Registers (or re-assigns to the caller) this device's FCM token.
   *
   * @param registration the token, platform and client
   * @return 204
   */
  @PutMapping
  @Operation(summary = "Register (or re-assign) this device's FCM token")
  public ResponseEntity<Void> register(@Valid @RequestBody DeviceRegistrationDto registration) {
    deviceTokenService.register(SecurityUtils.currentUserId(), registration);
    return ResponseEntity.noContent().build();
  }

  /**
   * Unregisters a token on logout.
   *
   * @param token the token
   * @return 204 (idempotent; unknown or foreign tokens are a no-op)
   */
  @DeleteMapping("/{token}")
  @Operation(summary = "Unregister a token (on logout)")
  public ResponseEntity<Void> unregister(@PathVariable String token) {
    deviceTokenService.unregister(SecurityUtils.currentUserId(), token);
    return ResponseEntity.noContent().build();
  }
}
