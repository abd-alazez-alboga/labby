package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Driver location streaming (TRK-01, TRK-04).
 *
 * @param streamIntervalSeconds how often an online driver app sends a sample (default 5)
 * @param staleAfterSeconds an online driver whose last sample is older than this is stale and gets
 *     no new offers (default 30)
 */
@ConfigurationProperties(prefix = "labby.tracking")
public record TrackingProperties(int streamIntervalSeconds, int staleAfterSeconds) {}
