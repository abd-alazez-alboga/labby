package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * Create a public shared ride (UC-R-12): one pickup, one destination (no stops), the seats offered,
 * the creator's own party and payment method, and the departure rule.
 */
public record CreateSharedRideRequestDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    @NotNull UUID serviceTypeId,
    @NotNull PaymentMethod paymentMethod,
    @NotNull @Min(2) @Max(8) Integer totalSeats,
    @NotNull @Min(1) @Max(8) Integer partySize,
    @NotNull @Valid DepartureRequestDto departure,
    @Size(max = 20) String promoCode) {}
