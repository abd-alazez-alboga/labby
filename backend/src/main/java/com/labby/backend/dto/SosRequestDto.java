package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * An SOS trigger (comms-v1.yaml {@code POST /rides/{rideId}/sos}, SAFE-01).
 *
 * @param lat latitude of the device when SOS was tapped
 * @param lng longitude
 * @param recordedAt the device moment (clamped to server time when ahead)
 */
public record SosRequestDto(
    @NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
    @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng,
    @NotNull Instant recordedAt) {}
