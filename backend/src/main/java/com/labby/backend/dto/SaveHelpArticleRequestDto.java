package com.labby.backend.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * Create / edit an article; a draft needs a working title in at least one language. Body length is
 * the service's rule (422 {@code body_too_long}), not bean validation's.
 */
public record SaveHelpArticleRequestDto(
    @NotNull UUID helpCategoryId,
    @Size(max = 160) String titleEn,
    @Size(max = 160) String titleAr,
    String bodyEn,
    String bodyAr) {}
