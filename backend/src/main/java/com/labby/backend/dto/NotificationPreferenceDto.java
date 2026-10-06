package com.labby.backend.dto;

import com.labby.backend.enums.NotificationCategory;

/**
 * A category's push preference (realtime-v1.yaml {@code NotificationPreference}, UC-S-12).
 *
 * @param category the category
 * @param enabled whether pushes of this category are sent (the center records regardless)
 * @param locked true for ride and safety: always enabled (NTF-02)
 */
public record NotificationPreferenceDto(
    NotificationCategory category, boolean enabled, boolean locked) {}
