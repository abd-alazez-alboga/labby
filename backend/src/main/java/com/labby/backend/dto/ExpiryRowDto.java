package com.labby.backend.dto;

import java.time.Instant;

/**
 * One current document on the expiry dashboard (UC-A-12).
 *
 * @param document the approved current document
 * @param driver the driver
 * @param daysLeft {@code expiresOn − today}; negative once expired
 * @param driverSuspended the driver role is suspended
 * @param renewalPending a renewal of this slot awaits review
 * @param reminder30SentAt when the 30-day reminder went out, or null
 * @param reminder7SentAt when the 7-day reminder went out, or null
 */
public record ExpiryRowDto(
    DocumentDto document,
    ApplicantDto driver,
    long daysLeft,
    boolean driverSuspended,
    boolean renewalPending,
    Instant reminder30SentAt,
    Instant reminder7SentAt) {}
