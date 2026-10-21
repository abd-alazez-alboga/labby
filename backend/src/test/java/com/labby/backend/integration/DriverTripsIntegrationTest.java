package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * V1 conformance W43 (REP-01, UC-S-18; boards V1FDriverEarningsTrips / TripDetail /
 * TripDetailCancelled / ReportPastTrip): the driver's earnings list also holds the rides they
 * accepted that were later cancelled — with or without money — and a trip detail carries the rider,
 * the labels, the moments, the money lines and the driver's own report on that rider.
 */
class DriverTripsIntegrationTest extends AbstractTrustIntegrationTest {

  @Test
  @DisplayName("cancelled-after-acceptance rides are trips too; never-accepted ones are not")
  void shouldListCancelledTripsWithTheMoneyTrips() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID completed = completeRide(rider(), driver, "cash");
    ok(driverAction(driver, completed, "cash-confirm"), HttpStatus.OK);
    Account hadi = newRider();
    Instant now = CLOCK.instant();
    UUID riderCancelled =
        ride(
            hadi.userId(),
            driver.userId(),
            "cancelled_by_rider",
            now.plus(Duration.ofMinutes(50)),
            null,
            null,
            now.plus(Duration.ofHours(1)));
    UUID driverCancelled =
        ride(
            hadi.userId(),
            driver.userId(),
            "cancelled_by_driver",
            now.plus(Duration.ofMinutes(110)),
            null,
            null,
            now.plus(Duration.ofHours(2)));
    // Never accepted by anyone: no trip.
    ride(hadi.userId(), null, "cancelled_by_rider", null, null, null, now.plusSeconds(30));

    JsonNode page = ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK);
    assertThat(page.get("totalItems").asLong()).isEqualTo(3);
    JsonNode items = page.get("items");
    assertThat(ids(items)).containsExactly(driverCancelled, riderCancelled, completed);

    JsonNode cancelled = items.get(1);
    assertThat(cancelled.get("rideState").asText()).isEqualTo("cancelled_by_rider");
    assertThat(cancelled.get("kind").asText()).isEqualTo("on_demand");
    assertThat(cancelled.get("riderFirstName").asText()).isEqualTo("Rana");
    assertThat(cancelled.get("fareTotal").decimalValue()).isEqualByComparingTo("0");
    assertThat(cancelled.get("net").decimalValue()).isEqualByComparingTo("0");
    assertThat(cancelled.get("cancellationFee").isNull()).isTrue();
    assertThat(cancelled.get("cancellationFeeCharged").isNull()).isTrue();
    assertThat(cancelled.get("cancellationReason").asText()).isEqualTo("changed_mind");
    assertThat(Instant.parse(cancelled.get("completedAt").asText()))
        .isEqualTo(now.plus(Duration.ofHours(1)));
    assertThat(Instant.parse(cancelled.get("cancelledAt").asText()))
        .isEqualTo(now.plus(Duration.ofHours(1)));
    assertThat(cancelled.get("acceptedAt").isNull()).isFalse();
    assertThat(cancelled.get("myReport").isNull()).isTrue();
    assertThat(cancelled.get("canReport").asBoolean()).isTrue();

    JsonNode money = items.get(2);
    assertThat(money.get("rideState").asText()).isEqualTo("completed");
    assertThat(money.get("fareTotal").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(money.get("commissionAmount").decimalValue()).isEqualByComparingTo(COMMISSION);
    assertThat(money.get("net").decimalValue()).isEqualByComparingTo("-0.38");
    assertThat(money.get("riderFirstName").isNull()).isFalse();
    assertThat(money.get("serviceTypeNameEn").isNull()).isFalse();
    assertThat(money.get("startedAt").isNull()).isFalse();
    assertThat(money.get("canReport").asBoolean()).isTrue();

    JsonNode paged =
        ok(get("/api/v1/driver/earnings?size=2&page=1", driver.token()), HttpStatus.OK);
    assertThat(paged.get("totalPages").asInt()).isEqualTo(2);
    assertThat(ids(paged.get("items"))).containsExactly(completed);
  }

  @Test
  @DisplayName("the trip detail shows the driver's own report on a past trip's rider, once")
  void shouldShowTheReportOnTheTripDetail() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account hadi = newRider();
    Instant now = CLOCK.instant();
    UUID cancelled =
        ride(
            hadi.userId(),
            driver.userId(),
            "cancelled_by_rider",
            now.minus(Duration.ofDays(9)),
            null,
            null,
            now.minus(Duration.ofDays(9)).plusSeconds(360));
    String detail = "/api/v1/driver/earnings/rides/" + cancelled;
    assertThat(ok(get(detail, driver.token()), HttpStatus.OK).get("canReport").asBoolean())
        .isTrue();

    // REP-01 from a past trip (no time limit; cancelled after acceptance is reportable).
    ok(
        post(
            "/api/v1/rides/" + cancelled + "/reports",
            Map.of("category", "inappropriate_behavior", "photoFileIds", List.of()),
            driver.token()),
        HttpStatus.CREATED);
    JsonNode trip = ok(get(detail, driver.token()), HttpStatus.OK);
    assertThat(trip.get("riderFirstName").asText()).isEqualTo("Rana");
    assertThat(trip.get("canReport").asBoolean()).isFalse();
    JsonNode report = trip.get("myReport");
    assertThat(report.get("category").asText()).isEqualTo("inappropriate_behavior");
    assertThat(report.get("status").asText()).isEqualTo("open");
    assertThat(report.get("id").isNull()).isFalse();
    assertThat(report.get("createdAt").isNull()).isFalse();
    // The list row carries the same report.
    JsonNode row =
        ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK).get("items").get(0);
    assertThat(row.get("myReport").get("status").asText()).isEqualTo("open");

    // Not this driver's trip, or never accepted: 404.
    Account other = newDriver();
    assertThat(get(detail, other.token()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    UUID neverAccepted =
        ride(hadi.userId(), null, "cancelled_by_rider", null, null, null, now.plusSeconds(30));
    assertThat(
            get("/api/v1/driver/earnings/rides/" + neverAccepted, driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  private static List<UUID> ids(JsonNode items) {
    List<UUID> ids = new ArrayList<>();
    items.forEach(item -> ids.add(UUID.fromString(item.get("rideId").asText())));
    return ids;
  }
}
