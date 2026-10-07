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

  /**
   * Removes every token of the account. Called by each path that revokes ALL of the account's
   * sessions (refresh-token reuse, password reset/change, account deletion) so no device — an
   * attacker's included — keeps receiving the account's pushes after losing its session.
   *
   * @param userId the account
   */
  void removeAllForUser(UUID userId);
}
