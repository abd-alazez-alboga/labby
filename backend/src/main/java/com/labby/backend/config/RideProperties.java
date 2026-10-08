package com.labby.backend.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The on-demand ride loop (rides-v1.yaml; SRS §9 defaults).
 *
 * @param offerSeconds how long a driver has to answer an offer (RIDE-03: 15 s)
 * @param giveUpMinutes dispatch gives up this long after the request (RIDE-03: 10 min)
 * @param arriveGeofenceMeters "Arrived" is allowed within this distance of the pickup (RIDE-04: 100
 *     m)
 * @param candidatePoolSize how many nearest eligible drivers (straight line) are ranked by routed
 *     pickup ETA for each offer
 * @param etaRefreshSeconds the rider-facing ETA is recomputed at most this often (TRK-02: 30 s)
 * @param dispatchCron the dispatcher tick (expired offers, next candidate, give-up); "-" disables
 * @param monitorCron the ride monitor tick (stream-lost edges, ETA refresh); "-" disables
 */
@ConfigurationProperties(prefix = "labby.rides")
public record RideProperties(
    int offerSeconds,
    int giveUpMinutes,
    int arriveGeofenceMeters,
    int candidatePoolSize,
    int etaRefreshSeconds,
    String dispatchCron,
    String monitorCron) {

  /**
   * The offer window.
   *
   * @return the window
   */
  public Duration offerWindow() {
    return Duration.ofSeconds(offerSeconds);
  }

  /**
   * The dispatch give-up delay.
   *
   * @return the delay
   */
  public Duration giveUpAfter() {
    return Duration.ofMinutes(giveUpMinutes);
  }
}
