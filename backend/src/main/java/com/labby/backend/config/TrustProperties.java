package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * M11 trust & quality platform config (trust-v1.yaml). Per-region values (rating thresholds, metric
 * warnings) live on the region; these are platform-wide.
 *
 * @param reportFlagCount REP-03: substantiated reports against one user x role that open a {@code
 *     report_threshold} flag (default 3)
 * @param reportFlagDays REP-03: the sliding window, in days, on the reports' resolution moment
 *     (default 90)
 * @param ratingSnapshotCron the daily RATE-02 snapshot rewrite (the averages users see); {@code -}
 *     disables the trigger (tests)
 * @param metricWarningCron the DRV-07 warning evaluation over active drivers; {@code -} disables
 *     the trigger (tests)
 */
@ConfigurationProperties(prefix = "labby.trust")
public record TrustProperties(
    int reportFlagCount, int reportFlagDays, String ratingSnapshotCron, String metricWarningCron) {}
