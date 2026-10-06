package com.labby.backend.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A renewed document (UC-D-19). Validated by the service (keys {@code number}, {@code expiresOn},
 * {@code fileId}).
 *
 * @param number the new document number
 * @param expiresOn the new expiry date; must be after today
 * @param fileId the caller's own upload of kind {@code document}
 */
public record DocumentRenewalRequestDto(String number, LocalDate expiresOn, UUID fileId) {}
