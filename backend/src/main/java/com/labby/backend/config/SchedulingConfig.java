package com.labby.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables {@code @Scheduled} jobs (the M5 document-expiry job). Each job's cron is configurable and
 * may be set to {@code -} to disable it — the integration tests do, and drive the job's service
 * method on a controlled clock instead.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
