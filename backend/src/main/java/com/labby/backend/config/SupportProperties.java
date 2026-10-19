package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * M14 support & content (support-v1.yaml).
 *
 * @param waitingReminderHours hours a ticket sits in {@code waiting_on_user} without a user reply
 *     before its ONE reminder (owner ruling 2026-10-19, default 48)
 * @param reminderCron cron of the reminder job; {@code -} disables the trigger (tests call the
 *     service on their clock)
 */
@ConfigurationProperties(prefix = "labby.support")
public record SupportProperties(int waitingReminderHours, String reminderCron) {}
