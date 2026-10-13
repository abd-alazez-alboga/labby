package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * M10 comms & safety (comms-v1.yaml).
 *
 * @param publicBaseUrl the absolute origin trip-share urls are built on (SHARE-01) — the public
 *     address riders' contacts reach, no trailing slash
 * @param shareRefreshSeconds how often the public share page polls its data (SHARE-02, default 5)
 * @param liveopsRefreshSeconds how often the admin live ops map polls its snapshot (ADM-03, default
 *     5)
 */
@ConfigurationProperties(prefix = "labby.comms")
public record CommsProperties(
    String publicBaseUrl, int shareRefreshSeconds, int liveopsRefreshSeconds) {}
