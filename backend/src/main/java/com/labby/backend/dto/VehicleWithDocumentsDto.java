package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import java.util.List;

/**
 * A vehicle plus its current registration + insurance (onboarding-v1.yaml {@code
 * VehicleWithDocuments} = Vehicle fields flattened + {@code documents}).
 *
 * @param vehicle the vehicle (serialized flat)
 * @param documents the vehicle's current registration and insurance
 */
public record VehicleWithDocumentsDto(
    @JsonUnwrapped VehicleDto vehicle, List<DocumentDto> documents) {}
