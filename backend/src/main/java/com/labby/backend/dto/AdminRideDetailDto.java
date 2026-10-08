package com.labby.backend.dto;

import java.util.List;
import java.util.UUID;

/** The full truth of one ride (UC-A-18). */
public record AdminRideDetailDto(
    RideDto ride,
    UUID riderUserId,
    String riderName,
    String riderPhone,
    UUID driverUserId,
    String driverName,
    String driverPhone,
    UUID vehicleId,
    String cancellationNote,
    List<OfferTrailEntryDto> offers,
    List<TracePointDto> trace) {}
