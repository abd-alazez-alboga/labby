package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * UC-D-15 summary ({@code GET /driver/earnings/summary}, money-v1): the Monday-start week or the
 * calendar month containing the anchor (default today, operating region time zone), totalled in the
 * operating region's currency; 404 without an operating region, 400 for an unknown period (M8 audit
 * W5).
 */
class DriverEarningsIntegrationTest extends AbstractMoneyIntegrationTest {

  private static final ZoneId DAMASCUS = ZoneId.of("Asia/Damascus");

  private static final String URL = "/api/v1/driver/earnings/summary";

  @Test
  @DisplayName("weekly and monthly totals cover the anchor's week / month in the region currency")
  void shouldSummarizeWeekAndMonth() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    grant(rider.userId(), "10.00");
    UUID rideId = completeRide(rider, driver, "wallet");
    ok(
        post("/api/v1/rides/" + rideId + "/tip", Map.of("amount", "0.50"), rider.token()),
        HttpStatus.CREATED);
    LocalDate today = LocalDate.ofInstant(CLOCK.instant(), DAMASCUS);

    JsonNode weekly = ok(get(URL + "?period=weekly", driver.token()), HttpStatus.OK);
    assertThat(weekly.get("period").asText()).isEqualTo("weekly");
    assertThat(weekly.get("from").asText()).isEqualTo(today.with(DayOfWeek.MONDAY).toString());
    assertThat(weekly.get("to").asText())
        .isEqualTo(today.with(DayOfWeek.MONDAY).plusDays(6).toString());
    assertThat(weekly.get("currency").asText()).isEqualTo("SYP");
    assertThat(weekly.get("trips").asInt()).isEqualTo(1);
    assertThat(weekly.get("fares").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(weekly.get("commission").decimalValue()).isEqualByComparingTo(COMMISSION);
    assertThat(weekly.get("tips").decimalValue()).isEqualByComparingTo("0.50");
    // ride_earning 1.50 − 0.38 = 1.12, plus the 0.50 tip.
    assertThat(weekly.get("net").decimalValue()).isEqualByComparingTo("1.62");

    JsonNode monthly = ok(get(URL + "?period=monthly", driver.token()), HttpStatus.OK);
    assertThat(monthly.get("from").asText()).isEqualTo(today.withDayOfMonth(1).toString());
    assertThat(monthly.get("to").asText())
        .isEqualTo(today.with(TemporalAdjusters.lastDayOfMonth()).toString());
    assertThat(monthly.get("trips").asInt()).isEqualTo(1);
    assertThat(monthly.get("net").decimalValue()).isEqualByComparingTo("1.62");
  }

  @Test
  @DisplayName(
      "M13 ruling 1: a promo ride's platform compensation rides on the trip row and the period net")
  void shouldIncludePromoCompensationInTripAndSummary() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Map<String, Object> promo = new java.util.LinkedHashMap<>();
    promo.put("code", "TENOFF");
    promo.put("type", "percent");
    promo.put("value", "10");
    promo.put("startsAt", CLOCK.instant().minus(java.time.Duration.ofHours(1)).toString());
    promo.put("endsAt", CLOCK.instant().plus(java.time.Duration.ofDays(1)).toString());
    ok(post("/api/v1/admin/promos", promo, admin), HttpStatus.CREATED);
    Map<String, Object> body = booking("cash");
    body.put("promoCode", "TENOFF");
    UUID rideId = UUID.fromString(ok(tryBook(rider, body), HttpStatus.CREATED).get("id").asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);

    // Commission on the pre-discount 1.50 (−0.38) + the 0.15 compensation = −0.23: the rider paid
    // 1.35 in cash, so the driver ends exactly where a promo-free 1.50 cash ride leaves them.
    JsonNode trip =
        ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK).get("items").get(0);
    assertThat(trip.get("fareTotal").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(trip.get("commissionAmount").decimalValue()).isEqualByComparingTo(COMMISSION);
    assertThat(trip.get("promoCompensation").decimalValue()).isEqualByComparingTo("0.15");
    assertThat(trip.get("net").decimalValue()).isEqualByComparingTo("-0.23");
    JsonNode weekly = ok(get(URL + "?period=weekly", driver.token()), HttpStatus.OK);
    assertThat(weekly.get("trips").asInt()).isEqualTo(1);
    assertThat(weekly.get("fares").decimalValue()).isEqualByComparingTo(FARE);
    assertThat(weekly.get("commission").decimalValue()).isEqualByComparingTo(COMMISSION);
    assertThat(weekly.get("net").decimalValue()).isEqualByComparingTo("-0.23");
    assertThat(driverBalance(driver.userId())).isEqualByComparingTo("-0.23");

    // A promo-free ride carries no compensation field.
    UUID plain = completeRide(rider, driver, "cash");
    ok(driverAction(driver, plain, "cash-confirm"), HttpStatus.OK);
    JsonNode plainTrip =
        ok(get("/api/v1/driver/earnings", driver.token()), HttpStatus.OK).get("items").get(0);
    assertThat(plainTrip.get("rideId").asText()).isEqualTo(plain.toString());
    assertThat(plainTrip.get("promoCompensation").isNull()).isTrue();
    assertThat(plainTrip.get("net").decimalValue()).isEqualByComparingTo(COMMISSION.negate());
  }

  @Test
  @DisplayName("an explicit anchor selects that period — a past week is empty")
  void shouldHonourExplicitAnchor() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    completeRide(rider, driver, "cash");
    LocalDate lastWeek = LocalDate.ofInstant(CLOCK.instant(), DAMASCUS).minusWeeks(1);

    JsonNode past =
        ok(get(URL + "?period=weekly&anchor=" + lastWeek, driver.token()), HttpStatus.OK);
    assertThat(past.get("from").asText()).isEqualTo(lastWeek.with(DayOfWeek.MONDAY).toString());
    assertThat(past.get("trips").asInt()).isZero();
    assertThat(past.get("net").decimalValue()).isEqualByComparingTo("0");

    JsonNode current =
        ok(
            get(
                URL + "?period=weekly&anchor=" + LocalDate.ofInstant(CLOCK.instant(), DAMASCUS),
                driver.token()),
            HttpStatus.OK);
    assertThat(current.get("trips").asInt()).isEqualTo(1);
    assertThat(current.get("net").decimalValue()).isEqualByComparingTo(COMMISSION.negate());
  }

  @Test
  @DisplayName("no operating region yet (never located, never rode) → 404")
  void shouldReturn404WithoutOperatingRegion() {
    Account driver = approvedDriver("+963937816001", "NOWHERE-1", economy, admin);
    assertThat(get(URL + "?period=weekly", driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("an unknown period is a 400 in the error shape, never a 500")
  void shouldRejectUnknownPeriod() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    var response = get(URL + "?period=daily", driver.token());
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(response.getBody().get("status").asInt()).isEqualTo(400);
    assertThat(response.getBody().get("message").asText()).isNotBlank();
    assertThat(get(URL, driver.token()).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
  }
}
