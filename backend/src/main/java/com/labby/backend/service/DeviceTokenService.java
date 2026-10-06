package com.labby.backend.service;

import com.labby.backend.dto.DeviceRegistrationDto;
import java.util.UUID;

/** FCM token registration (ES-03, UC-S-25): one account per device token at a time. */
public interface DeviceTokenService {

  /**
   * Registers the token for the caller, moving it from any other account.
   *
   * @param userId the caller
   * @param registration the token, platform and client
   */
  void register(UUID userId, DeviceRegistrationDto registration);

  /**
   * Removes the caller's token (idempotent; unknown or foreign tokens are a no-op).
   *
   * @param userId the caller
   * @param token the token
   */
  void unregister(UUID userId, String token);
}
