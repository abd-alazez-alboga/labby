package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/** Booking payload (UC-R-04): the route plus service type and payment method. */
public record BookRideRequestDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops,
    @NotNull UUID serviceTypeId,
    @NotNull PaymentMethod paymentMethod) {}
