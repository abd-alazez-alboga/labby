package com.labby.backend.dto;

import com.labby.backend.enums.ArticleStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * An article in any status with the fields that still block publishing (support-v1 {@code
 * AdminHelpArticle}).
 */
public record AdminHelpArticleDto(
    UUID helpArticleId,
    UUID helpCategoryId,
    String titleEn,
    String titleAr,
    String bodyEn,
    String bodyAr,
    int sortOrder,
    ArticleStatus status,
    Instant publishedAt,
    List<String> missing,
    Instant createdAt,
    Instant updatedAt) {}
