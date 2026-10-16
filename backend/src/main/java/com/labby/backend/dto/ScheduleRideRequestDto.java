package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Schedule a ride (UC-R-10, scheduled-shared-v1 ScheduleRideRequest): the booking inputs without an
 * expected surge (evaluated at execution) plus the pickup time — at least the region's minimum lead
 * ahead, no upper bound.
 */
public record ScheduleRideRequestDto(
    @NotNull @Valid PlaceDto pickup,
    @NotNull @Valid PlaceDto destination,
    List<@Valid PlaceDto> stops,
    @NotNull UUID serviceTypeId,
    @NotNull PaymentMethod paymentMethod,
    @NotNull Instant scheduledAt) {}
