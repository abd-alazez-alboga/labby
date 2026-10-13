package com.labby.backend.dto;

import java.time.Instant;

/**
 * A freshly created trip-share link (SHARE-01) — the ONLY time the raw token/url is served.
 *
 * @param url the absolute public page url, {@code <PUBLIC_BASE_URL>/share/<token>}
 * @param createdAt when the link was created
 */
public record ShareLinkDto(String url, Instant createdAt) {}
