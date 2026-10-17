package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Booking payload (UC-R-04): the route plus service type and payment method. {@code
 * expectedSurgeMultiplier} (optional) is the multiplier the rider was shown; when it no longer
 * matches the pickup zone's current value the booking is refused with 409 {@code surge_changed}
 * instead of locking a price the rider never saw (PRC-02); like every multiplier it is at least
 * 1.00 with at most 2 decimals (400 otherwise).
 */
public record BookRideRequestDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops,
    @NotNull UUID serviceTypeId,
    @NotNull PaymentMethod paymentMethod,
    @DecimalMin("1.00") @Digits(integer = 2, fraction = 2) BigDecimal expectedSurgeMultiplier,
    @Size(max = 20) String promoCode) {}
