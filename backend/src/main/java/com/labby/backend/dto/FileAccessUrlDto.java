package com.labby.backend.dto;

import java.time.Instant;

/**
 * An expiring URL to a private file (NFR-S2). Only ever issued by an authenticated,
 * permission-checked endpoint; the URL itself is the short-lived capability.
 *
 * @param url absolute, or relative to the API base URL (the local provider's {@code
 *     /api/v1/files/{token}})
 * @param expiresAt when the URL stops working
 */
public record FileAccessUrlDto(String url, Instant expiresAt) {}
