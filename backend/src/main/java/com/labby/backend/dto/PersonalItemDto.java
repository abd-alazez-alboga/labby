package com.labby.backend.dto;

import com.labby.backend.enums.ReviewStatus;

/**
 * The "personal details" review item: the account name + profile photo (owner decision M5-T1).
 *
 * @param name the account name
 * @param photo the profile photo with a fresh expiring URL, or null
 * @param reviewStatus pending, changes_requested or approved
 * @param reviewNote the change-request note
 */
public record PersonalItemDto(
    String name, FileRefDto photo, ReviewStatus reviewStatus, String reviewNote) {}
