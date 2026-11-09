package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Hosting / operations knobs that are not product behaviour.
 *
 * @param keepaliveUrl absolute URL this instance requests on a fixed cadence so a free-tier host
 *     that idles out never sleeps (the instance's own public health endpoint); blank disables the
 *     job, which is the default everywhere but the demo deployment
 * @param keepaliveIntervalSeconds seconds between two keepalive requests (default 600)
 */
@ConfigurationProperties(prefix = "labby.ops")
public record OpsProperties(String keepaliveUrl, int keepaliveIntervalSeconds) {

  /** Whether a keepalive URL is configured. */
  public boolean keepaliveEnabled() {
    return keepaliveUrl != null && !keepaliveUrl.isBlank();
  }
}
