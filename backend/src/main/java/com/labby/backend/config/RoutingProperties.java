package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The routing seam (ES-04, NFR-A3).
 *
 * @param osrmUrl OSRM base URL (public demo server in V1; self-hosted before launch)
 * @param osrmTimeoutSeconds how long to wait for OSRM before falling back (contract: 3 s)
 * @param fallbackDetourFactor straight-line fallback: great-circle distance multiplier (1.3)
 * @param fallbackSpeedKmh straight-line fallback: assumed average speed (25 km/h)
 */
@ConfigurationProperties(prefix = "labby.routing")
public record RoutingProperties(
    String osrmUrl, int osrmTimeoutSeconds, double fallbackDetourFactor, double fallbackSpeedKmh) {}
