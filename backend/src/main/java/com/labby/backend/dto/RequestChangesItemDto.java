package com.labby.backend.dto;

import com.labby.backend.enums.DocumentType;
import com.labby.backend.enums.ReviewItem;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * One flagged item of a change request, with its note (DRV-02).
 *
 * @param item personal, document or vehicle
 * @param documentType required iff {@code item} is document
 * @param note what the applicant must change
 */
public record RequestChangesItemDto(
    @NotNull ReviewItem item, DocumentType documentType, @NotBlank @Size(max = 1000) String note) {}
