package com.labby.backend.dto;

import com.labby.backend.enums.DocumentType;
import java.util.UUID;

/**
 * One of an approved driver's four document slots (UC-D-19).
 *
 * @param type the slot's document type
 * @param vehicleId the active vehicle for registration/insurance, null otherwise
 * @param current the approved current document
 * @param expired today is after {@code current.expiresOn}
 * @param renewal the pending renewal, or the latest rejected one with its reason, or null
 */
public record DocumentSlotDto(
    DocumentType type, UUID vehicleId, DocumentDto current, boolean expired, DocumentDto renewal) {}
