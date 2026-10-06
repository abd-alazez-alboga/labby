package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * A private file with a freshly minted, expiring URL (NFR-S2, onboarding-v1.yaml {@code FileRef}).
 * Only built after the serving endpoint's own authentication + permission check.
 *
 * @param fileId the stored file id (for the personal item's profile photo: the account id)
 * @param contentType the stored media type
 * @param url API-relative ({@code /api/v1/files/{token}}) or absolute
 * @param urlExpiresAt when the URL stops working
 */
public record FileRefDto(UUID fileId, String contentType, String url, Instant urlExpiresAt) {}
