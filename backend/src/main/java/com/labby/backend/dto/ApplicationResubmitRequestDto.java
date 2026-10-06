package com.labby.backend.dto;

import java.util.List;

/**
 * Resubmission of exactly the flagged items (UC-D-02).
 *
 * @param confirmPersonalDetails true iff the personal item is flagged (name/photo are edited
 *     through /users/me first)
 * @param documents exactly the flagged document types
 * @param vehicle present iff the vehicle is flagged
 */
public record ApplicationResubmitRequestDto(
    Boolean confirmPersonalDetails, List<DocumentInputDto> documents, VehicleInputDto vehicle) {}
