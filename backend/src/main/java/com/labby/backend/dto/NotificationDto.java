package com.labby.backend.dto;

import com.labby.backend.enums.NotificationCategory;
import java.time.Instant;
import java.util.UUID;

/**
 * One notification-center entry (realtime-v1.yaml {@code Notification}, UC-S-11).
 *
 * @param id the notification id
 * @param category the category
 * @param event the template key
 * @param title the title in the caller's current language
 * @param body the body in the caller's current language
 * @param link the deep link, or null
 * @param read whether it was read
 * @param createdAt when the event happened
 */
public record NotificationDto(
    UUID id,
    NotificationCategory category,
    String event,
    String title,
    String body,
    DeepLinkDto link,
    boolean read,
    Instant createdAt) {}
