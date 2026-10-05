package com.labby.backend.dto;

import java.util.List;
import java.util.UUID;

/**
 * The client-facing slice of an ACTIVE region (SD-01), cached by the apps: currency, emergency
 * number and ENABLED service types only.
 */
public record RegionConfigDto(
    UUID id,
    String name,
    String currency,
    String emergencyNumber,
    List<ServiceTypeDto> serviceTypes) {}
