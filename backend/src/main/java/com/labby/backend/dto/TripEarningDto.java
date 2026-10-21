package com.labby.backend.dto;

import com.labby.backend.enums.CancellationReason;
import com.labby.backend.enums.PaymentMethod;
import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideState;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * The COM-01 itemization of one ride's money (money-v1 TripEarning). For a cancelled ride whose fee
 * was collected for this driver, the fare fields are 0 and {@code cancellationFee} carries the
 * credit; {@code completedAt} is then the collection moment. {@code promoCompensation} (M13 ruling
 * 1) is the platform-funded promo discount credited for the ride, already inside {@code net}; null
 * when the ride had no promo.
 *
 * <p>V1 conformance W43 (REP-01, UC-S-18): a ride the driver ACCEPTED that was later cancelled is a
 * row too, even when no money moved for the driver (fare fields 0, {@code net} 0, {@code
 * completedAt} the cancellation moment). Every row carries what the trip detail shows: the rider's
 * first name (the member's on a shared ride, with {@code memberId}), labels, moments, the ride's
 * state and kind, the fee the rider was charged, and the driver's own report on that rider — {@code
 * canReport} is true while none exists.
 *
 * <p>Board V1FDriverTripDetail (route map): only the trip DETAIL of a completed ride carries {@code
 * pickup}, {@code destination} and {@code route} (the in_ride trace, as on the rider receipt); they
 * are null on cancelled rows and on every row of the paged list, which stays light.
 */
public record TripEarningDto(
    UUID rideId,
    Instant completedAt,
    String currency,
    BigDecimal fareTotal,
    PaymentMethod paymentMethod,
    BigDecimal commissionRate,
    BigDecimal commissionAmount,
    BigDecimal tip,
    BigDecimal cancellationFee,
    BigDecimal promoCompensation,
    BigDecimal net,
    UUID memberId,
    RideState rideState,
    RideKind kind,
    String riderFirstName,
    String pickupLabel,
    String destinationLabel,
    String serviceTypeNameEn,
    String serviceTypeNameAr,
    Instant acceptedAt,
    Instant startedAt,
    Instant cancelledAt,
    CancellationReason cancellationReason,
    BigDecimal cancellationFeeCharged,
    TripReportDto myReport,
    boolean canReport,
    PlaceDto pickup,
    PlaceDto destination,
    GeoJsonLineStringDto route) {

  /**
   * This row with the route map of the trip detail.
   *
   * @param pickup the ride's pickup
   * @param destination the ride's drop-off
   * @param route the in_ride trace ([lng, lat])
   * @return the row carrying the map
   */
  public TripEarningDto withMap(PlaceDto pickup, PlaceDto destination, GeoJsonLineStringDto route) {
    return new TripEarningDto(
        rideId,
        completedAt,
        currency,
        fareTotal,
        paymentMethod,
        commissionRate,
        commissionAmount,
        tip,
        cancellationFee,
        promoCompensation,
        net,
        memberId,
        rideState,
        kind,
        riderFirstName,
        pickupLabel,
        destinationLabel,
        serviceTypeNameEn,
        serviceTypeNameAr,
        acceptedAt,
        startedAt,
        cancelledAt,
        cancellationReason,
        cancellationFeeCharged,
        myReport,
        canReport,
        pickup,
        destination,
        route);
  }

  /**
   * The driver's own report on this trip's rider (trust-v1 OwnReport subset).
   *
   * @param id the report
   * @param category its category
   * @param status open / substantiated / unsubstantiated
   * @param createdAt when it was sent
   */
  public record TripReportDto(
      UUID id, ReportCategory category, ReportStatus status, Instant createdAt) {}
}
