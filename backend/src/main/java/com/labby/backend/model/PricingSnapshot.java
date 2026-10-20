package com.labby.backend.model;

import java.math.BigDecimal;

/**
 * The pricing inputs locked on a ride at request time (V33, V1 audit H4): the service type's rates
 * and the region's PRC-03 extras and RIDE-07 cancellation values, with the SRS defaults already
 * applied. Completion, extras and cancellation are priced from it, never from the live config.
 *
 * @param baseFare the service type's base fare
 * @param perKmRate the service type's per-km rate
 * @param perMinRate the service type's per-minute rate
 * @param minimumFare the service type's minimum fare
 * @param waitGraceMin the region's free wait after Arrived, in minutes
 * @param waitPerMinRate the region's wait charge per minute
 * @param pickupFeeThresholdKm the region's pickup distance included free
 * @param pickupFeePerKm the region's pickup-distance fee per km beyond the threshold
 * @param cancellationGraceMin the region's free-cancellation grace after acceptance, in minutes
 * @param cancellationFee the region's cancellation fee, or null when it charges nothing
 */
public record PricingSnapshot(
    BigDecimal baseFare,
    BigDecimal perKmRate,
    BigDecimal perMinRate,
    BigDecimal minimumFare,
    Integer waitGraceMin,
    BigDecimal waitPerMinRate,
    BigDecimal pickupFeeThresholdKm,
    BigDecimal pickupFeePerKm,
    Integer cancellationGraceMin,
    BigDecimal cancellationFee) {}
