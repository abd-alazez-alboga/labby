package com.labby.backend.dto;

import com.labby.backend.enums.DocumentType;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One document of a submission (DRV-01). Validated by the service so errors are keyed per item
 * ({@code documents[<type>].<field>}, onboarding-v1.yaml).
 *
 * @param type the document type
 * @param number the document number (1..50 chars)
 * @param expiresOn the expiry date; must be after today (UC-D-01 E2)
 * @param fileId the caller's own upload of kind {@code document}
 */
public record DocumentInputDto(
    DocumentType type, String number, LocalDate expiresOn, UUID fileId) {}
