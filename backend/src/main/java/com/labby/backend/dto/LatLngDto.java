package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * A WGS-84 point (realtime-v1.yaml {@code LatLng}).
 *
 * @param lat latitude in [-90, 90]
 * @param lng longitude in [-180, 180]
 */
public record LatLngDto(
    @NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
    @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng) {}
