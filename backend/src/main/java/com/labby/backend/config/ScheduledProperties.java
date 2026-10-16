package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * M12 scheduled & shared rides platform config (scheduled-shared-v1.yaml). The per-region timing
 * (reminders, fallback lead, earliest booking) lives on the region ({@code scheduledSettings}).
 *
 * @param cron the clock job tick (reminders, conversion / fallback, shared departure / expiry);
 *     {@code -} disables the trigger (tests drive it on a controlled clock)
 * @param batchSize how many due rides one tick handles at most
 */
@ConfigurationProperties(prefix = "labby.scheduled")
public record ScheduledProperties(String cron, int batchSize) {}
