package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The M15 incentives engine (incentives-v1.yaml; DRV-08).
 *
 * @param cron the weekly evaluation tick (operating zone; default Monday 00:30; "-" disables) —
 *     each run pays the previous Monday–Sunday week in every region's own time zone
 */
@ConfigurationProperties(prefix = "labby.incentives")
public record IncentiveProperties(String cron) {}
