package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The M15 incentives engine (incentives-v1.yaml; DRV-08).
 *
 * @param cron the evaluation tick (operating zone; default hourly; "-" disables) — each run pays
 *     every region's last finished Monday–Sunday week in that region's own time zone, so a region
 *     is paid within an hour of its own Monday and a missed run is caught up by the next
 */
@ConfigurationProperties(prefix = "labby.incentives")
public record IncentiveProperties(String cron) {}
