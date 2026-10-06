package com.labby.backend.dto;

import com.labby.backend.enums.NotificationCategory;

/**
 * One entry of a partial preference update.
 *
 * @param category the category to change
 * @param enabled the new state
 */
public record NotificationPreferenceUpdateDto(NotificationCategory category, Boolean enabled) {}
