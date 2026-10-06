package com.labby.backend.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * One GPS fix from a driver app (realtime-v1.yaml {@code LocationSample}, TRK-01).
 *
 * @param lat latitude in [-90, 90]
 * @param lng longitude in [-180, 180]
 * @param headingDeg optional heading in [0, 360)
 * @param speedMps optional speed, m/s, non-negative
 * @param accuracyM optional accuracy radius, m, non-negative
 * @param recordedAt the device fix time (orders samples; older ones are ignored)
 */
public record LocationSampleDto(
    @NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
    @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng,
    @DecimalMin("0") @DecimalMax(value = "360", inclusive = false) Double headingDeg,
    @DecimalMin("0") Double speedMps,
    @DecimalMin("0") Double accuracyM,
    @NotNull Instant recordedAt) {}
