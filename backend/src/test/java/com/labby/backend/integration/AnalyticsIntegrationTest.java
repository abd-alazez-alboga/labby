package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.repository.AnalyticsRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * M15-T1 dashboard formulas (analytics-v1.yaml, ADM-02) against a hand-counted fixture. Two rides
 * complete through the real API (cash, the 1.50 minimum fare, 25% → 0.38 commission each, accept →
 * arrive exactly 1 s); the rest are inserted at exact moments. The expected numbers in each test
 * are counted from the fixture table in {@link #seed()}, not computed.
 */
class AnalyticsIntegrationTest extends AbstractTrustIntegrationTest {

  @Autowired private AnalyticsRepository analyticsRepository;
  @Autowired private TransactionTemplate transactionTemplate;

  private Instant t0;
  private UUID otherRegionId;

  /**
   * The fixture, every ride requested in {@code [t0 - 1 h, t0 + 2 h)} unless marked:
   *
   * <pre>
   * ride  region    state                rider driver  offers (in range)        accept→arrive  fare / commission
   * A     Damascus  completed            R1    D1      accepted                 1 s            1.50 / 0.38 (API)
   * B     Damascus  completed            R2    D1      accepted                 1 s            1.50 / 0.38 (API)
   * C     Damascus  cancelled_by_driver  R3    D2      accepted                 298 s          —
   * D     Damascus  no_driver_found      R3    —       declined, timeout        —              —
   * E     Damascus  cancelled_by_rider   R1    D1      accepted                 —              —
   * F     Damascus  accepted (active)    R2    D2      withdrawn, accepted      —              —
   * G     Damascus  completed            R1    D1      —                        —              OUT OF RANGE (t0 - 3 h)
   * H     Aleppo    completed            R3    D2      —                        300 s          2.00 / — (no ledger)
   * </pre>
   *
   * D1 is online (its active vehicle serves Damascus Economy), D2 offline. Surge: Damascus "Hot" at
   * 1.50, "Calm" at 1.00. Signups: every account moved to t0 - 2 days, then R1 and D1 back to t0 +
   * 1 min (R1 rider; D1 rider + driver).
   */
  private void seed() {
    t0 = nextLocalTen();
    CLOCK.set(t0);
    Account d1 = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account d2 = newDriver();
    Account r1 = newRider();
    Account r2 = newRider();
    Account r3 = newRider();

    completeRide(r1, d1, "cash"); // A
    completeRide(r2, d1, "cash"); // B

    UUID c =
        ride(
            r3.userId(),
            d2.userId(),
            "cancelled_by_driver",
            t0.plus(Duration.ofMinutes(10)),
            t0.plus(Duration.ofMinutes(10)).plusSeconds(298),
            null,
            t0.plus(Duration.ofMinutes(16)));
    offer(c, d2.userId(), t0.plus(Duration.ofMinutes(9)).plusSeconds(30), "accepted", 120);

    CLOCK.set(t0.plus(Duration.ofMinutes(20)));
    UUID d = ride(r3.userId(), null, "no_driver_found", null, null, null, null);
    offer(d, d1.userId(), t0.plus(Duration.ofMinutes(19)), "declined", 60);
    offer(d, d2.userId(), t0.plus(Duration.ofMinutes(19)).plusSeconds(20), "timeout", 90);

    UUID e =
        ride(
            r1.userId(),
            d1.userId(),
            "cancelled_by_rider",
            t0.plus(Duration.ofMinutes(25)),
            null,
            null,
            t0.plus(Duration.ofMinutes(26)));
    offer(e, d1.userId(), t0.plus(Duration.ofMinutes(24)).plusSeconds(30), "accepted", 60);

    UUID f =
        ride(
            r2.userId(),
            d2.userId(),
            "accepted",
            t0.plus(Duration.ofMinutes(30)),
            null,
            null,
            null);
    offer(f, d1.userId(), t0.plus(Duration.ofMinutes(29)), "withdrawn", 60);
    offer(f, d2.userId(), t0.plus(Duration.ofMinutes(29)).plusSeconds(20), "accepted", 60);

    completedRide(r1.userId(), d1.userId(), t0.minus(Duration.ofHours(3))); // G

    otherRegionId =
        jdbcTemplate.queryForObject(
            "INSERT INTO regions (name, state, currency, emergency_number, boundary) VALUES"
                + " ('Aleppo Test', 'active', 'SYP', '112', ST_GeomFromText('POLYGON((37.0 36.0,"
                + " 37.3 36.0, 37.3 36.3, 37.0 36.3, 37.0 36.0))', 4326)) RETURNING region_id",
            UUID.class);
    UUID aleppoEconomy =
        jdbcTemplate.queryForObject(
            "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
                + " per_min_rate, minimum_fare) VALUES (?, 'Economy', 'اقتصادي', 1.00, 0.50, 0.10,"
                + " 1.50) RETURNING service_type_id",
            UUID.class,
            otherRegionId);
    UUID h = completedRide(r3.userId(), d2.userId(), t0.plus(Duration.ofMinutes(40)));
    jdbcTemplate.update(
        "UPDATE rides SET region_id = ?, service_type_id = ? WHERE ride_id = ?",
        otherRegionId,
        aleppoEconomy,
        h);
    jdbcTemplate.update(
        "INSERT INTO fares (ride_id, currency, distance_m, duration_s, base_fare, distance_fare,"
            + " time_fare, total) VALUES (?, 'SYP', 2000, 600, 2.00, 0, 0, 2.00)",
        h);

    for (String[] zone : new String[][] {{"Hot", "1.50"}, {"Calm", "1.00"}}) {
      jdbcTemplate.update(
          "INSERT INTO surge_zones (region_id, name, polygon, threshold_steps, current_multiplier)"
              + " VALUES (?, ?, ST_GeomFromText('POLYGON((36.25 33.45, 36.35 33.45, 36.35 33.55,"
              + " 36.25 33.55, 36.25 33.45))', 4326), '[]', ?::numeric)",
          regionId,
          zone[0],
          zone[1]);
    }

    jdbcTemplate.update("UPDATE users SET created_at = ?", ts(t0.minus(Duration.ofDays(2))));
    jdbcTemplate.update(
        "UPDATE users SET created_at = ? WHERE user_id IN (?, ?)",
        ts(t0.plusSeconds(60)),
        r1.userId(),
        d1.userId());
  }

  private JsonNode dashboard(UUID region) {
    return ok(
        get(
            "/api/v1/admin/analytics?from="
                + t0.minus(Duration.ofHours(1))
                + "&to="
                + t0.plus(Duration.ofHours(2))
                + (region == null ? "" : "&regionId=" + region),
            admin),
        HttpStatus.OK);
  }

  @Test
  @DisplayName("ADM-02 all regions: every figure matches the hand count")
  void shouldMatchHandCountAcrossRegions() {
    seed();
    JsonNode body = dashboard(null);

    JsonNode rides = body.get("rides");
    assertThat(rides.get("total").asLong()).isEqualTo(7); // A B C D E F H
    assertThat(rides.get("completed").asLong()).isEqualTo(3); // A B H
    assertThat(rides.get("cancelledByRider").asLong()).isEqualTo(1); // E
    assertThat(rides.get("cancelledByDriver").asLong()).isEqualTo(1); // C
    assertThat(rides.get("noDriverFound").asLong()).isEqualTo(1); // D
    assertThat(rides.get("completionRate").decimalValue()).isEqualByComparingTo("0.5000"); // 3/6
    JsonNode byRegion = rides.get("byRegion");
    assertThat(byRegion).hasSize(2);
    assertThat(byRegion.get(0).get("regionName").asText()).isEqualTo("Aleppo Test");
    assertThat(byRegion.get(0).get("total").asLong()).isEqualTo(1);
    assertThat(byRegion.get(0).get("completed").asLong()).isEqualTo(1);
    assertThat(byRegion.get(1).get("regionName").asText()).isEqualTo("Damascus Rides");
    assertThat(byRegion.get(1).get("total").asLong()).isEqualTo(6);
    assertThat(byRegion.get(1).get("completed").asLong()).isEqualTo(2);
    assertThat(byRegion.get(1).get("cancelled").asLong()).isEqualTo(2); // C E
    JsonNode byServiceType = rides.get("byServiceType");
    assertThat(byServiceType).hasSize(2);
    assertThat(byServiceType.get(0).get("regionId").asText()).isEqualTo(otherRegionId.toString());
    assertThat(byServiceType.get(1).get("serviceTypeId").asText()).isEqualTo(economy.toString());
    assertThat(byServiceType.get(1).get("nameAr").asText()).isEqualTo("اقتصادي");
    assertThat(byServiceType.get(1).get("total").asLong()).isEqualTo(6);
    JsonNode daily = rides.get("daily");
    assertThat(daily).hasSize(1);
    assertThat(daily.get(0).get("date").asText())
        .isEqualTo(LocalDate.ofInstant(t0, OPERATING_ZONE).toString());
    assertThat(daily.get(0).get("total").asLong()).isEqualTo(7);
    assertThat(daily.get(0).get("completed").asLong()).isEqualTo(3);
    assertThat(daily.get(0).get("cancelled").asLong()).isEqualTo(2);

    JsonNode revenue = body.get("revenue");
    assertThat(revenue.get("totals")).hasSize(1);
    assertThat(revenue.get("totals").get(0).get("currency").asText()).isEqualTo("SYP");
    assertThat(revenue.get("totals").get(0).get("grossFares").decimalValue())
        .isEqualByComparingTo("5.00"); // 1.50 + 1.50 + 2.00
    assertThat(revenue.get("totals").get(0).get("commission").decimalValue())
        .isEqualByComparingTo("0.76"); // 0.38 + 0.38
    assertThat(revenue.get("byRegion")).hasSize(2);
    assertThat(revenue.get("byRegion").get(0).get("grossFares").decimalValue())
        .isEqualByComparingTo("2.00");
    assertThat(revenue.get("byRegion").get(0).get("commission").decimalValue())
        .isEqualByComparingTo("0.00");
    assertThat(revenue.get("byRegion").get(1).get("grossFares").decimalValue())
        .isEqualByComparingTo("3.00");
    assertThat(revenue.get("byRegion").get(1).get("commission").decimalValue())
        .isEqualByComparingTo("0.76");

    JsonNode users = body.get("users");
    assertThat(users.get("signups").get("scope").asText()).isEqualTo("platform");
    assertThat(users.get("signups").get("riders").asLong()).isEqualTo(2); // R1, D1
    assertThat(users.get("signups").get("drivers").asLong()).isEqualTo(1); // D1
    assertThat(users.get("activeRiders").asLong()).isEqualTo(3); // R1 R2 R3
    assertThat(users.get("activeDrivers").asLong()).isEqualTo(2); // D1 D2
    assertThat(users.get("driversOnlineNow").asLong()).isEqualTo(1); // D1

    JsonNode ops = body.get("ops");
    assertThat(ops.get("avgPickupSeconds").asLong()).isEqualTo(150); // (1 + 1 + 298 + 300) / 4
    assertThat(ops.get("offersAccepted").asLong()).isEqualTo(5); // A B C E F
    assertThat(ops.get("offersAnswered").asLong()).isEqualTo(7); // + declined + timeout
    assertThat(ops.get("acceptanceRate").decimalValue()).isEqualByComparingTo("0.7143"); // 5/7
    assertThat(ops.get("activeSurgeZones").asLong()).isEqualTo(1); // Hot
  }

  @Test
  @DisplayName("ADM-02 region filter narrows rides, money, active parties and ops; not signups")
  void shouldNarrowToRegion() {
    seed();
    JsonNode body = dashboard(regionId);

    JsonNode rides = body.get("rides");
    assertThat(rides.get("total").asLong()).isEqualTo(6);
    assertThat(rides.get("completed").asLong()).isEqualTo(2);
    assertThat(rides.get("completionRate").decimalValue()).isEqualByComparingTo("0.4000"); // 2/5
    assertThat(rides.get("byRegion")).hasSize(1);
    assertThat(body.get("revenue").get("totals").get(0).get("grossFares").decimalValue())
        .isEqualByComparingTo("3.00");
    assertThat(body.get("revenue").get("totals").get(0).get("commission").decimalValue())
        .isEqualByComparingTo("0.76");
    JsonNode users = body.get("users");
    assertThat(users.get("signups").get("riders").asLong()).isEqualTo(2); // platform-wide
    assertThat(users.get("activeRiders").asLong()).isEqualTo(2); // R1 R2
    assertThat(users.get("activeDrivers").asLong()).isEqualTo(1); // D1
    assertThat(users.get("driversOnlineNow").asLong()).isEqualTo(1);
    JsonNode ops = body.get("ops");
    assertThat(ops.get("avgPickupSeconds").asLong()).isEqualTo(100); // (1 + 1 + 298) / 3
    assertThat(ops.get("acceptanceRate").decimalValue()).isEqualByComparingTo("0.7143");
    assertThat(ops.get("activeSurgeZones").asLong()).isEqualTo(1);

    JsonNode aleppo = dashboard(otherRegionId);
    assertThat(aleppo.get("rides").get("total").asLong()).isEqualTo(1);
    assertThat(aleppo.get("users").get("driversOnlineNow").asLong()).isZero();
    assertThat(aleppo.get("ops").get("offersAnswered").asLong()).isZero();
    assertThat(aleppo.get("ops").get("acceptanceRate").isNull()).isTrue();
    assertThat(aleppo.get("ops").get("activeSurgeZones").asLong()).isZero();
  }

  @Test
  @DisplayName("ADM-02 daily buckets are region-local days, not UTC days")
  void shouldBucketDaysInTheRegionZone() {
    // A future region-local day D in Asia/Damascus (UTC+3, the test region's zone).
    ZonedDateTime day = ZonedDateTime.now(OPERATING_ZONE).truncatedTo(ChronoUnit.DAYS).plusDays(2);
    Instant halfPastMidnight = day.withMinute(30).toInstant(); // D 00:30 local = D-1 21:30 UTC
    Instant ten = day.withHour(10).toInstant(); // D 10:00 local = D 07:00 UTC
    assertThat(LocalDate.ofInstant(halfPastMidnight, ZoneOffset.UTC))
        .isEqualTo(day.toLocalDate().minusDays(1));
    CLOCK.set(halfPastMidnight);
    Account rider = newRider();
    // ride() stamps requested_at at the clock minus 60 s when nothing was accepted.
    CLOCK.set(halfPastMidnight.plusSeconds(60));
    ride(rider.userId(), null, "no_driver_found", null, null, null, null);
    CLOCK.set(ten.plusSeconds(60));
    ride(rider.userId(), null, "no_driver_found", null, null, null, null);

    JsonNode daily =
        ok(
                get(
                    "/api/v1/admin/analytics?from="
                        + day.toInstant()
                        + "&to="
                        + day.plusDays(1).toInstant()
                        + "&regionId="
                        + regionId,
                    admin),
                HttpStatus.OK)
            .get("rides")
            .get("daily");
    // Both rides on local day D (a UTC bucket would split them over D-1 and D).
    assertThat(daily).hasSize(1);
    assertThat(daily.get(0).get("date").asText()).isEqualTo(day.toLocalDate().toString());
    assertThat(daily.get(0).get("total").asLong()).isEqualTo(2);
  }

  @Test
  @DisplayName("an empty range: zero counts, null rates, no rows")
  void shouldAnswerEmptyRange() {
    Instant from = CLOCK.instant().plus(Duration.ofDays(30));
    JsonNode body =
        ok(
            get(
                "/api/v1/admin/analytics?from=" + from + "&to=" + from.plus(Duration.ofDays(1)),
                admin),
            HttpStatus.OK);
    assertThat(body.get("rides").get("total").asLong()).isZero();
    assertThat(body.get("rides").get("completionRate").isNull()).isTrue();
    assertThat(body.get("rides").get("daily")).isEmpty();
    assertThat(body.get("revenue").get("totals")).isEmpty();
    assertThat(body.get("ops").get("avgPickupSeconds").isNull()).isTrue();
  }

  @Test
  @DisplayName("range validation and the analytics:view gate")
  void shouldValidateRangeAndPermission() {
    Instant now = CLOCK.instant();
    assertThat(code(get("/api/v1/admin/analytics?from=" + now + "&to=" + now, admin)))
        .isEqualTo("invalid_range");
    assertThat(
            code(
                get(
                    "/api/v1/admin/analytics?from=" + now + "&to=" + now.plus(Duration.ofDays(367)),
                    admin)))
        .isEqualTo("range_too_long");
    assertThat(get("/api/v1/admin/analytics?to=" + now, admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            get(
                    "/api/v1/admin/analytics?from=" + now + "&to=" + now.plusSeconds(60),
                    supportAdmin("+963937800001"))
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("the statement time limit cancels a slow statement as a QueryTimeoutException")
  void shouldCancelStatementsOverTheLimit() {
    assertThatThrownBy(
            () ->
                transactionTemplate.executeWithoutResult(
                    status -> {
                      analyticsRepository.limitStatementTime(Duration.ofMillis(100));
                      jdbcTemplate.execute("SELECT pg_sleep(2)");
                    }))
        .isInstanceOf(QueryTimeoutException.class);
  }

  /** The next 10:00 in the operating zone, so every fixture moment falls on one local day. */
  private static Instant nextLocalTen() {
    ZonedDateTime now = ZonedDateTime.now(OPERATING_ZONE);
    ZonedDateTime ten = now.truncatedTo(ChronoUnit.DAYS).withHour(10);
    return (ten.isAfter(now) ? ten : ten.plusDays(1)).toInstant();
  }
}
