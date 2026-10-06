package com.labby.backend.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The realtime WebSocket {@code /api/v1/realtime} (realtime-v1.yaml protocol).
 *
 * @param authTimeoutSeconds a new socket must authenticate within this (contract: 10 s) or is
 *     closed with 4401
 * @param idleTimeoutSeconds a socket without any frame for this long is closed (contract: 60 s)
 * @param checkIntervalSeconds how often each socket's token expiry, session liveness and idleness
 *     are checked
 */
@ConfigurationProperties(prefix = "labby.realtime")
public record RealtimeProperties(
    int authTimeoutSeconds, int idleTimeoutSeconds, int checkIntervalSeconds) {

  /**
   * The auth deadline.
   *
   * @return the auth timeout
   */
  public Duration authTimeout() {
    return Duration.ofSeconds(authTimeoutSeconds);
  }

  /**
   * The idle limit.
   *
   * @return the idle timeout
   */
  public Duration idleTimeout() {
    return Duration.ofSeconds(idleTimeoutSeconds);
  }
}
