package com.labby.backend.dto;

import java.util.UUID;

/** A published article row (support-v1 {@code HelpArticleSummary}). */
public record HelpArticleSummaryDto(
    UUID helpArticleId, UUID helpCategoryId, LocalizedTextDto title, int sortOrder) {}
