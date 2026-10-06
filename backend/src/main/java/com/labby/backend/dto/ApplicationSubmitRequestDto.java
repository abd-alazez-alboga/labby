package com.labby.backend.dto;

import java.util.List;

/**
 * A full driver application (UC-D-01): exactly one document of each type plus the vehicle.
 *
 * @param documents the four documents
 * @param vehicle the vehicle
 */
public record ApplicationSubmitRequestDto(
    List<DocumentInputDto> documents, VehicleInputDto vehicle) {}
