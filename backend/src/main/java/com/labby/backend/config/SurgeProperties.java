package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The surge cycle (PRC-02, DRV-09).
 *
 * @param cycleCron when every zone's multiplier is recomputed (Spring cron, default every 2
 *     minutes); "-" disables
 */
@ConfigurationProperties(prefix = "labby.surge")
public record SurgeProperties(String cycleCron) {}
