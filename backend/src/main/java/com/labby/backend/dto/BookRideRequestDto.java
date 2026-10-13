package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Booking payload (UC-R-04): the route plus service type and payment method. {@code
 * expectedSurgeMultiplier} (optional) is the multiplier the rider was shown; when it no longer
 * matches the pickup zone's current value the booking is refused with 409 {@code surge_changed}
 * instead of locking a price the rider never saw (PRC-02).
 */
public record BookRideRequestDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops,
    @NotNull UUID serviceTypeId,
    @NotNull PaymentMethod paymentMethod,
    BigDecimal expectedSurgeMultiplier) {}
