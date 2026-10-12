package com.labby.backend.dto;

import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** A completed ride's receipt, rendered from stored components (UC-R-07). */
public record ReceiptDto(
    UUID rideId,
    UUID regionId,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    PlaceDto pickup,
    PlaceDto destination,
    List<PlaceDto> stops,
    RideTimelineDto timeline,
    FinalFareDto fare,
    PaymentMethod paymentMethod,
    PaymentStatus paymentStatus,
    BigDecimal walletApplied,
    BigDecimal cashDue,
    List<CarriedDueDto> carriedDues,
    BigDecimal tip,
    DriverSummaryDto driver,
    GeoJsonLineStringDto route) {}
