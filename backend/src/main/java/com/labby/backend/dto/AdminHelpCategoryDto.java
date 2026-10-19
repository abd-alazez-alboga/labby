package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/** A help category with its article counts (support-v1 {@code AdminHelpCategory}, UC-A-23). */
public record AdminHelpCategoryDto(
    UUID helpCategoryId,
    String nameEn,
    String nameAr,
    int sortOrder,
    long articleCount,
    long publishedCount,
    Instant createdAt,
    Instant updatedAt) {}
