package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.PaymentStatus;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One ride as its rider or its driver sees it (rides-v1 Ride). {@code myRating} (M11) is the
 * caller's own rating state — absent in admin views. {@code scheduled} (M12) is set on rides of
 * kind {@code scheduled} only.
 */
public record RideDto(
    UUID id,
    RideState state,
    RideKind kind,
    UUID regionId,
    UUID serviceTypeId,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    PlaceDto pickup,
    PlaceDto destination,
    List<PlaceDto> stops,
    PaymentMethod paymentMethod,
    PickupDistanceMode pickupDistanceMode,
    BigDecimal surgeMultiplier,
    BigDecimal surchargePercent,
    EstimateDto estimate,
    RideTimelineDto timeline,
    Instant cancellationGraceEndsAt,
    Instant waitGraceEndsAt,
    CancellationReason cancellationReason,
    BigDecimal cancellationFee,
    FinalFareDto fare,
    PaymentStatus paymentStatus,
    BigDecimal walletApplied,
    BigDecimal cashDue,
    List<CarriedDueDto> carriedDues,
    BigDecimal tip,
    String driverStream,
    LatLngPointDto driverPosition,
    Integer etaSeconds,
    UUID retryOfRideId,
    UUID redispatchOfRideId,
    UUID redispatchedAsRideId,
    DriverSummaryDto driver,
    RiderSummaryDto rider,
    @JsonInclude(JsonInclude.Include.NON_NULL) MyRatingDto myRating,
    ScheduledInfoDto scheduled) {}
