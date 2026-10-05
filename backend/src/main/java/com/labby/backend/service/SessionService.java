package com.labby.backend.service;

import java.util.UUID;

/** Session liveness checks for the security layer (UC-S-03). */
public interface SessionService {

  /**
   * Whether the session behind an access token's {@code sid} claim is still live.
   *
   * @param sessionId the refresh-token row id embedded in the access token
   * @return true when the session exists and has not been revoked
   */
  boolean isSessionLive(UUID sessionId);
}
