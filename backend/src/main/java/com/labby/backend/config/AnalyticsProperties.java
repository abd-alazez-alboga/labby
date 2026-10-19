package com.labby.backend.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The M15 analytics dashboard and CSV exports (analytics-v1.yaml; SRS ADM-02/06).
 *
 * @param statementTimeout the PostgreSQL {@code statement_timeout} of every analytics / export SQL
 *     statement (default 10 s)
 * @param exportMaxRows the most rows one CSV export may hold (owner ruling 2026-10-20: 50,000)
 */
@ConfigurationProperties(prefix = "labby.analytics")
public record AnalyticsProperties(Duration statementTimeout, int exportMaxRows) {}
