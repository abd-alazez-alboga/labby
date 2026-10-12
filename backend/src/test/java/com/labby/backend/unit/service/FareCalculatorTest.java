package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.FareComponentsDto;
import com.labby.backend.model.ServiceType;
import com.labby.backend.model.SurchargeWindow;
import com.labby.backend.service.FareCalculator;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * PRC-01 / RIDE-06 fare engine: component arithmetic with half-up rounding per component, the
 * minimum-fare top-up as its own component, surcharge and surge on the subtotal, and the owner's
 * surcharge-window rules (2026-10-07): region time zone, overnight windows across midnight, start =
 * end = whole day, overlapping windows → highest percent.
 */
class FareCalculatorTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  private final FareCalculator calculator = new FareCalculator();

  private static ServiceType economy() {
    return ServiceType.builder()
        .nameEn("Economy")
        .nameAr("اقتصادي")
        .baseFare(new BigDecimal("1.00"))
        .perKmRate(new BigDecimal("0.50"))
        .perMinRate(new BigDecimal("0.10"))
        .minimumFare(new BigDecimal("1.50"))
        .build();
  }

  @Test
  @DisplayName("base + km + min, each rounded half-up; total is their sum when above the minimum")
  void shouldPriceDistanceAndDuration() {
    // 2038 m, 600 s: distance 0.50 × 2.038 = 1.019 → 1.02; time 0.10 × 10 = 1.00.
    FareComponentsDto fare =
        calculator.price(economy(), "SYP", 2038, 600, BigDecimal.ZERO, BigDecimal.ONE);

    assertThat(fare.currency()).isEqualTo("SYP");
    assertThat(fare.baseFare()).isEqualByComparingTo("1.00");
    assertThat(fare.distanceFare()).isEqualByComparingTo("1.02");
    assertThat(fare.timeFare()).isEqualByComparingTo("1.00");
    assertThat(fare.surchargeAmount()).isEqualByComparingTo("0.00");
    assertThat(fare.surgeAmount()).isEqualByComparingTo("0.00");
    assertThat(fare.waitFare()).isEqualByComparingTo("0.00");
    assertThat(fare.pickupFee()).isEqualByComparingTo("0.00");
    assertThat(fare.discount()).isEqualByComparingTo("0.00");
    assertThat(fare.minimumFareAdjustment()).isEqualByComparingTo("0.00");
    assertThat(fare.total()).isEqualByComparingTo("3.02");
  }

  @Test
  @DisplayName("below the minimum: a top-up component lifts the total to exactly the minimum")
  void shouldFloorAtMinimumFare() {
    FareComponentsDto fare =
        calculator.price(economy(), "SYP", 0, 0, BigDecimal.ZERO, BigDecimal.ONE);

    assertThat(fare.baseFare()).isEqualByComparingTo("1.00");
    assertThat(fare.minimumFareAdjustment()).isEqualByComparingTo("0.50");
    assertThat(fare.total()).isEqualByComparingTo("1.50");
  }

  @Test
  @DisplayName(
      "PRC-03 extras: wait and pickup fees are their own components, outside surcharge/surge,"
          + " and count toward the minimum before any top-up")
  void shouldAddExtrasBeforeTheMinimumFloor() {
    // subtotal 1.00 + 1.00 + 0.50 = 2.50; +10% = 0.25; surge 1.2 on 2.75 = 0.55; extras are NOT
    // surged: + wait 0.807 → 0.81 + pickup 1.125 → 1.13 = 5.24.
    FareComponentsDto fare =
        calculator.price(
            economy(),
            "SYP",
            2000,
            300,
            new BigDecimal("10"),
            new BigDecimal("1.2"),
            new BigDecimal("0.807"),
            new BigDecimal("1.125"));

    assertThat(fare.surchargeAmount()).isEqualByComparingTo("0.25");
    assertThat(fare.surgeAmount()).isEqualByComparingTo("0.55");
    assertThat(fare.waitFare()).isEqualByComparingTo("0.81");
    assertThat(fare.pickupFee()).isEqualByComparingTo("1.13");
    assertThat(fare.minimumFareAdjustment()).isEqualByComparingTo("0.00");
    assertThat(fare.total()).isEqualByComparingTo("5.24");

    // A zero-distance ride: base 1.00 + wait 0.30 = 1.30 → top-up 0.20 to the 1.50 minimum.
    FareComponentsDto floored =
        calculator.price(
            economy(),
            "SYP",
            0,
            0,
            BigDecimal.ZERO,
            BigDecimal.ONE,
            new BigDecimal("0.30"),
            BigDecimal.ZERO);
    assertThat(floored.waitFare()).isEqualByComparingTo("0.30");
    assertThat(floored.minimumFareAdjustment()).isEqualByComparingTo("0.20");
    assertThat(floored.total()).isEqualByComparingTo("1.50");
  }

  @Test
  @DisplayName("surcharge is a percent of the subtotal; surge uplifts subtotal + surcharge")
  void shouldApplySurchargeThenSurge() {
    // subtotal 1.00 + 2.50 + 1.00 = 4.50; +25% = 1.125 → 1.13; surge 1.2 on 5.63 = 1.126 → 1.13.
    FareComponentsDto fare =
        calculator.price(economy(), "SYP", 5000, 600, new BigDecimal("25"), new BigDecimal("1.2"));

    assertThat(fare.surchargePercent()).isEqualByComparingTo("25.00");
    assertThat(fare.surchargeAmount()).isEqualByComparingTo("1.13");
    assertThat(fare.surgeMultiplier()).isEqualByComparingTo("1.20");
    assertThat(fare.surgeAmount()).isEqualByComparingTo("1.13");
    assertThat(fare.total()).isEqualByComparingTo("6.76");
    assertThat(
            fare.baseFare()
                .add(fare.distanceFare())
                .add(fare.timeFare())
                .add(fare.surchargeAmount())
                .add(fare.surgeAmount())
                .add(fare.minimumFareAdjustment()))
        .isEqualByComparingTo(fare.total());
  }

  @Test
  @DisplayName("a daytime window covers [start, end) on its days, in the region's time zone")
  void shouldMatchDaytimeWindowInRegionZone() {
    // Sun–Thu (ISO 7,1,2,3,4) 07:30–09:30 local Damascus time.
    SurchargeWindow rush = window("07:30", "09:30", List.of(7, 1, 2, 3, 4), "25");

    assertThat(percentAt(rush, "2026-10-04T07:30")).isEqualByComparingTo("25"); // Sunday, start
    assertThat(percentAt(rush, "2026-10-04T09:29")).isEqualByComparingTo("25");
    assertThat(percentAt(rush, "2026-10-04T09:30")).isEqualByComparingTo("0"); // end exclusive
    assertThat(percentAt(rush, "2026-10-04T07:29")).isEqualByComparingTo("0");
    assertThat(percentAt(rush, "2026-10-09T08:00")).isEqualByComparingTo("0"); // Friday
    // 05:00 UTC is 08:00 in Damascus (UTC+3): the window applies in REGION time.
    assertThat(
            calculator.surchargePercent(
                List.of(rush), Instant.parse("2026-10-04T05:00:00Z"), DAMASCUS))
        .isEqualByComparingTo("25");
  }

  @Test
  @DisplayName("an overnight window spans midnight and belongs to the day it starts on")
  void shouldMatchOvernightWindow() {
    // Thursday (ISO 4) 22:00 → Friday 02:00.
    SurchargeWindow night = window("22:00", "02:00", List.of(4), "15");

    assertThat(percentAt(night, "2026-10-08T23:00")).isEqualByComparingTo("15"); // Thu late
    assertThat(percentAt(night, "2026-10-09T01:59")).isEqualByComparingTo("15"); // Fri early
    assertThat(percentAt(night, "2026-10-09T02:00")).isEqualByComparingTo("0");
    assertThat(percentAt(night, "2026-10-09T23:00")).isEqualByComparingTo("0"); // Fri late
    assertThat(percentAt(night, "2026-10-08T01:00")).isEqualByComparingTo("0"); // Thu early
  }

  @Test
  @DisplayName("start = end covers the whole day; overlapping windows → the highest percent")
  void shouldTreatEqualBoundsAsWholeDayAndTakeHighestOverlap() {
    SurchargeWindow allFriday = window("00:00", "00:00", List.of(5), "10");
    SurchargeWindow fridayEvening = window("18:00", "21:00", List.of(5), "30");
    List<SurchargeWindow> windows = List.of(allFriday, fridayEvening);

    assertThat(percentAt(windows, "2026-10-09T03:00")).isEqualByComparingTo("10");
    assertThat(percentAt(windows, "2026-10-09T19:00")).isEqualByComparingTo("30"); // not 40
    assertThat(percentAt(windows, "2026-10-10T19:00")).isEqualByComparingTo("0"); // Saturday
  }

  private BigDecimal percentAt(SurchargeWindow window, String localDateTime) {
    return percentAt(List.of(window), localDateTime);
  }

  private BigDecimal percentAt(List<SurchargeWindow> windows, String localDateTime) {
    Instant at = LocalDateTime.parse(localDateTime).atZone(DAMASCUS).toInstant();
    return calculator.surchargePercent(windows, at, DAMASCUS);
  }

  private static SurchargeWindow window(
      String start, String end, List<Integer> days, String percent) {
    return SurchargeWindow.builder()
        .label("w")
        .startsAt(LocalTime.parse(start))
        .endsAt(LocalTime.parse(end))
        .daysOfWeek(days)
        .percent(new BigDecimal(percent))
        .build();
  }
}
