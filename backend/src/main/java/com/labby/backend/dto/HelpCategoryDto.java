package com.labby.backend.dto;

import java.util.UUID;

/** A help category holding published articles (support-v1 {@code HelpCategory}, UC-S-21). */
public record HelpCategoryDto(
    UUID helpCategoryId, LocalizedTextDto name, int sortOrder, long articleCount) {}
