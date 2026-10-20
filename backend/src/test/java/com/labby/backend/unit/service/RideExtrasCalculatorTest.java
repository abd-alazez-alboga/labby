package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.enums.OfferResponse;
import com.labby.backend.enums.PickupDistanceMode;
import com.labby.backend.model.PricingSnapshot;
import com.labby.backend.model.Region;
import com.labby.backend.model.Ride;
import com.labby.backend.model.RideOffer;
import com.labby.backend.repository.RideOfferRepository;
import com.labby.backend.service.RideExtrasCalculator;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * PRC-03 extras per region config (M8 audit W9): a region with NON-default values (grace 3 min,
 * 0.40/min, threshold 4 km, 1.10/km) so a test can tell region values from the SRS defaults; the
 * wait charge prorates per second from the grace end to the start, the pickup fee bills only {@code
 * accept_distant_fee} rides beyond the threshold, both HALF_UP to 2 decimals.
 */
@ExtendWith(MockitoExtension.class)
class RideExtrasCalculatorTest {

  private static final Instant ARRIVED = Instant.parse("2026-10-12T10:00:00Z");

  @Mock private RideOfferRepository rideOfferRepository;

  private RideExtrasCalculator calculator;

  @BeforeEach
  void setUp() {
    calculator = new RideExtrasCalculator(rideOfferRepository);
  }

  private static Region region() {
    return Region.builder()
        .name("Custom")
        .waitGraceMin(3)
        .waitPerMinRate(new BigDecimal("0.40"))
        .pickupFeeThresholdKm(new BigDecimal("4"))
        .pickupFeePerKm(new BigDecimal("1.10"))
        .build();
  }

  private static Ride waited(Instant arrivedAt, long startedAfterSeconds) {
    return Ride.builder()
        .driverArrivedAt(arrivedAt)
        .startedAt(arrivedAt == null ? ARRIVED : arrivedAt.plusSeconds(startedAfterSeconds))
        .build();
  }

  @Test
  @DisplayName("no Arrived step → no wait charge")
  void shouldNotChargeWithoutArrived() {
    assertThat(calculator.waitFare(waited(null, 0), region())).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName("a start exactly at the grace end (or inside it) charges nothing")
  void shouldNotChargeAtGraceEnd() {
    assertThat(calculator.waitChargeStartsAt(waited(ARRIVED, 0), region()))
        .isEqualTo(ARRIVED.plusSeconds(180));
    assertThat(calculator.waitFare(waited(ARRIVED, 180), region())).isEqualByComparingTo("0");
    assertThat(calculator.waitFare(waited(ARRIVED, 120), region())).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName("partial minutes prorate per second at the REGION rate, HALF_UP to 2 decimals")
  void shouldProratePartialMinutes() {
    // 150 s past the 3-min grace = 2.5 min × 0.40 = 1.00.
    assertThat(calculator.waitFare(waited(ARRIVED, 330), region())).isEqualByComparingTo("1.00");
    // 440 s past = 7.333333 min × 0.40 = 2.9333 → 2.93.
    assertThat(calculator.waitFare(waited(ARRIVED, 620), region())).isEqualByComparingTo("2.93");
    // 1 s past = 0.016667 min × 0.40 = 0.0067 → 0.01.
    assertThat(calculator.waitFare(waited(ARRIVED, 181), region())).isEqualByComparingTo("0.01");
  }

  @Test
  @DisplayName("an unset region value falls back to the SRS default (grace 5 min, 0.25/min)")
  void shouldFallBackToSrsDefaults() {
    Region unset = Region.builder().name("Unset").build();
    // 6 min after Arrived = 1 min past the default 5-min grace × 0.25.
    assertThat(calculator.waitFare(waited(ARRIVED, 360), unset)).isEqualByComparingTo("0.25");
    assertThat(calculator.waitPerMinRate(waited(ARRIVED, 0), unset)).isEqualByComparingTo("0.25");
  }

  @Test
  @DisplayName("nearby_only rides never pay a pickup fee (the offer is not even looked up)")
  void shouldNotChargeNearbyOnly() {
    Ride ride =
        Ride.builder()
            .id(UUID.randomUUID())
            .pickupDistanceMode(PickupDistanceMode.NEARBY_ONLY)
            .build();
    assertThat(calculator.pickupFee(ride, region())).isEqualByComparingTo("0");
    verify(rideOfferRepository, never())
        .findFirstByRideIdAndResponseOrderBySequenceDesc(any(), any());
  }

  @Test
  @DisplayName("accept_distant_fee: within the region threshold → 0; beyond → km over × rate")
  void shouldChargeBeyondTheRegionThreshold() {
    Ride ride =
        Ride.builder()
            .id(UUID.randomUUID())
            .pickupDistanceMode(PickupDistanceMode.ACCEPT_DISTANT_FEE)
            .build();
    accepted(ride, 3_500);
    assertThat(calculator.pickupFee(ride, region())).isEqualByComparingTo("0");
    accepted(ride, 4_000);
    assertThat(calculator.pickupFee(ride, region())).isEqualByComparingTo("0");
    // 6.25 km − 4 km = 2.25 × 1.10 = 2.475 → 2.48.
    accepted(ride, 6_250);
    assertThat(calculator.pickupFee(ride, region())).isEqualByComparingTo("2.48");
  }

  @Test
  @DisplayName("accept_distant_fee without an accepted offer → no fee")
  void shouldNotChargeWithoutAcceptedOffer() {
    Ride ride =
        Ride.builder()
            .id(UUID.randomUUID())
            .pickupDistanceMode(PickupDistanceMode.ACCEPT_DISTANT_FEE)
            .build();
    when(rideOfferRepository.findFirstByRideIdAndResponseOrderBySequenceDesc(
            ride.getId(), OfferResponse.ACCEPTED))
        .thenReturn(Optional.empty());
    assertThat(calculator.pickupFee(ride, region())).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName("V1 audit H4: the values locked on the ride win over a later region edit")
  void shouldPriceExtrasFromTheSnapshot() {
    PricingSnapshot locked =
        new PricingSnapshot(
            new BigDecimal("1.00"),
            new BigDecimal("0.50"),
            new BigDecimal("0.10"),
            new BigDecimal("1.50"),
            5,
            new BigDecimal("0.25"),
            new BigDecimal("10"),
            new BigDecimal("0.50"),
            2,
            new BigDecimal("2.00"));
    Ride ride = waited(ARRIVED, 360);
    ride.setPricingSnapshot(locked);
    // The region now says grace 3 / 0.40 — the ride keeps grace 5 / 0.25: 1 min × 0.25.
    assertThat(calculator.waitChargeStartsAt(ride, region())).isEqualTo(ARRIVED.plusSeconds(300));
    assertThat(calculator.waitFare(ride, region())).isEqualByComparingTo("0.25");
    assertThat(calculator.waitPerMinRate(ride, region())).isEqualByComparingTo("0.25");
    Ride distant =
        Ride.builder()
            .id(UUID.randomUUID())
            .pickupDistanceMode(PickupDistanceMode.ACCEPT_DISTANT_FEE)
            .pricingSnapshot(locked)
            .build();
    // 12 km − the locked 10 km = 2 × the locked 0.50 (the region now says 4 km / 1.10).
    accepted(distant, 12_000);
    assertThat(calculator.pickupFee(distant, region())).isEqualByComparingTo("1.00");
  }

  private void accepted(Ride ride, int pickupDistanceM) {
    when(rideOfferRepository.findFirstByRideIdAndResponseOrderBySequenceDesc(
            ride.getId(), OfferResponse.ACCEPTED))
        .thenReturn(Optional.of(RideOffer.builder().pickupDistanceM(pickupDistanceM).build()));
  }
}
