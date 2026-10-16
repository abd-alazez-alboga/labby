package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * A shared ride as browse card / detail / member view (scheduled-shared-v1 SharedRide) — occupancy
 * only, never other members' names or phones.
 */
public record SharedRideDto(
    UUID rideId,
    RideState state,
    UUID regionId,
    PlaceDto pickup,
    PlaceDto destination,
    UUID serviceTypeId,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    DepartureDto departure,
    int totalSeats,
    int seatsTaken,
    int seatsLeft,
    BigDecimal estimateTotal,
    String currency,
    boolean pricedAtDispatch,
    String creatorFirstName,
    boolean isCreator,
    MemberViewDto me,
    CancellationReason cancellationReason) {}
