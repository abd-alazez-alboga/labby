package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/** One published article, both languages (support-v1 {@code HelpArticle}). */
public record HelpArticleDto(
    UUID helpArticleId,
    UUID helpCategoryId,
    LocalizedTextDto title,
    int sortOrder,
    LocalizedTextDto body,
    Instant publishedAt) {}
