package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Join a shared ride (UC-R-13) with a party size and the member's own payment method. */
public record JoinSharedRideRequestDto(
    @NotNull @Min(1) @Max(8) Integer partySize,
    @NotNull PaymentMethod paymentMethod,
    @Size(max = 20) String promoCode) {}
