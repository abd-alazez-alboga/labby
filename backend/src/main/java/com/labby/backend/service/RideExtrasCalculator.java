package com.labby.backend.service;

import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.repository.RideOfferRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The PRC-03 fare extras, per region config with the SRS defaults when a value is unset: the wait
 * charge bills the minutes beyond the wait grace between Arrived and the trip start, the
 * pickup-distance fee bills the accepted offer's pickup distance beyond the threshold — only for
 * {@code accept_distant_fee} riders (disclosed pre-booking, UC-R-04 A3). Amounts round HALF_UP to 2
 * decimals.
 */
@Component
@RequiredArgsConstructor
public class RideExtrasCalculator {

  /** SRS PRC-03 defaults when the region has no value set. */
  static final int DEFAULT_WAIT_GRACE_MIN = 5;

  static final BigDecimal DEFAULT_WAIT_PER_MIN_RATE = new BigDecimal("0.25");
  static final BigDecimal DEFAULT_PICKUP_FEE_THRESHOLD_KM = new BigDecimal("10");
  static final BigDecimal DEFAULT_PICKUP_FEE_PER_KM = new BigDecimal("0.50");

  private static final BigDecimal SIXTY = BigDecimal.valueOf(60);
  private static final BigDecimal THOUSAND = BigDecimal.valueOf(1000);

  private final RideOfferRepository rideOfferRepository;

  /**
   * The wait charge of a ride about to complete: minutes beyond the region's wait grace between
   * {@code driverArrivedAt} and {@code startedAt}, at the per-minute rate.
   *
   * @param ride the ride (started)
   * @param region its region
   * @return the charge (0 when no wait accrued or the ride skipped Arrived)
   */
  public BigDecimal waitFare(Ride ride, Region region) {
    if (ride.getDriverArrivedAt() == null || ride.getStartedAt() == null) {
      return BigDecimal.ZERO;
    }
    long chargedSeconds =
        Duration.between(waitChargeStartsAt(ride, region), ride.getStartedAt()).toSeconds();
    if (chargedSeconds <= 0) {
      return BigDecimal.ZERO;
    }
    BigDecimal minutes = BigDecimal.valueOf(chargedSeconds).divide(SIXTY, 6, RoundingMode.HALF_UP);
    return minutes.multiply(waitPerMinRate(region)).setScale(2, RoundingMode.HALF_UP);
  }

  /**
   * When wait-charge accrual starts (the rider is notified at this moment, PRC-03).
   *
   * @param ride the ride (arrived)
   * @param region its region
   * @return {@code driverArrivedAt} + the region's wait grace
   */
  public Instant waitChargeStartsAt(Ride ride, Region region) {
    int graceMinutes =
        region.getWaitGraceMin() == null ? DEFAULT_WAIT_GRACE_MIN : region.getWaitGraceMin();
    return ride.getDriverArrivedAt().plusSeconds(60L * graceMinutes);
  }

  /**
   * The region's wait per-minute rate (SRS default when unset).
   *
   * @param region the region
   * @return the rate
   */
  public BigDecimal waitPerMinRate(Region region) {
    return region.getWaitPerMinRate() == null
        ? DEFAULT_WAIT_PER_MIN_RATE
        : region.getWaitPerMinRate();
  }

  /**
   * The pickup-distance fee: (accepted offer's pickup distance km − threshold) × per-km rate, only
   * when the ride's mode is {@code accept_distant_fee} (PRC-03; the mode was locked at booking).
   *
   * @param ride the ride (accepted)
   * @param region its region
   * @return the fee (0 for {@code nearby_only} riders or distances within the threshold)
   */
  public BigDecimal pickupFee(Ride ride, Region region) {
    if (ride.getPickupDistanceMode() != PickupDistanceMode.ACCEPT_DISTANT_FEE) {
      return BigDecimal.ZERO;
    }
    Integer distanceM =
        rideOfferRepository
            .findFirstByRideIdAndResponseOrderBySequenceDesc(ride.getId(), OfferResponse.ACCEPTED)
            .map(RideOffer::getPickupDistanceM)
            .orElse(null);
    if (distanceM == null) {
      return BigDecimal.ZERO;
    }
    BigDecimal threshold =
        region.getPickupFeeThresholdKm() == null
            ? DEFAULT_PICKUP_FEE_THRESHOLD_KM
            : region.getPickupFeeThresholdKm();
    BigDecimal perKm =
        region.getPickupFeePerKm() == null ? DEFAULT_PICKUP_FEE_PER_KM : region.getPickupFeePerKm();
    BigDecimal overKm =
        BigDecimal.valueOf(distanceM).divide(THOUSAND, 6, RoundingMode.HALF_UP).subtract(threshold);
    if (overKm.signum() <= 0) {
      return BigDecimal.ZERO;
    }
    return overKm.multiply(perKm).setScale(2, RoundingMode.HALF_UP);
  }
}
