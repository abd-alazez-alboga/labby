package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.DriverLocationService;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.convention.TestBean;

/**
 * M6-T3 acceptance on a CONTROLLED clock: online/offline gates in the contract's order (DRV-05,
 * UC-D-04 E1 — incl. suspended-for-expiry with its reason), the REST location fallback (TRK-01:
 * offline rejected, out-of-order ignored, newest of a batch wins) and stale-stream detection
 * (TRK-04: silence past 30 s flags the driver, samples resuming clear it).
 */
class DriverAvailabilityIntegrationTest extends AbstractOnboardingIntegrationTest {

  private static final DocumentExpiryIntegrationTest.MutableClock CLOCK =
      new DocumentExpiryIntegrationTest.MutableClock();

  @TestBean private Clock clock;

  @Autowired private DriverLocationService driverLocationService;

  private String admin;
  private UUID economy;

  static Clock clock() {
    return CLOCK;
  }

  @BeforeEach
  void setUp() {
    CLOCK.set(Instant.now().truncatedTo(ChronoUnit.MICROS));
    admin = registerSuperAdmin("+963936000001");
    economy = serviceType("Economy", true, true);
  }

  private void advance(Duration duration) {
    CLOCK.set(CLOCK.instant().plus(duration));
  }

  private ResponseEntity<JsonNode> put(String url, Object body, String token) {
    HttpHeaders headers = bearer(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return restTemplate.exchange(
        url, HttpMethod.PUT, new HttpEntity<>(body, headers), JsonNode.class);
  }

  private JsonNode availability(Account driver) {
    return ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK);
  }

  private ResponseEntity<JsonNode> goOnline(Account driver, boolean online) {
    return put("/api/v1/driver/availability", Map.of("online", online), driver.token());
  }

  private static Map<String, Object> sample(double lat, double lng, Instant recordedAt) {
    return Map.of("lat", lat, "lng", lng, "recordedAt", recordedAt.toString());
  }

  private ResponseEntity<JsonNode> postSamples(Account driver, List<Map<String, Object>> samples) {
    return post("/api/v1/driver/locations", Map.of("samples", samples), driver.token());
  }

  private Instant storedRecordedAt(UUID userId) {
    return jdbcTemplate
        .queryForObject(
            "SELECT recorded_at FROM driver_locations WHERE user_id = ?", Timestamp.class, userId)
        .toInstant();
  }

  @Test
  @DisplayName("approved driver: online/offline idempotent; stream defaults from config")
  void shouldGoOnlineAndOffline() {
    Account driver = approvedDriver("+963936000011", "AV1", economy, admin);

    JsonNode initial = availability(driver);
    assertThat(initial.get("online").asBoolean()).isFalse();
    assertThat(initial.get("onlineSince").isNull()).isTrue();
    assertThat(initial.get("canGoOnline").asBoolean()).isTrue();
    assertThat(initial.get("cannotGoOnlineReason").isNull()).isTrue();
    assertThat(initial.get("offersBlockedReason").isNull()).isTrue();
    assertThat(initial.get("streamHealthy").isNull()).isTrue();
    assertThat(initial.get("streamIntervalSeconds").asInt()).isEqualTo(5);
    assertThat(initial.get("staleAfterSeconds").asInt()).isEqualTo(30);

    Instant wentOnline = CLOCK.instant();
    JsonNode online = ok(goOnline(driver, true), HttpStatus.OK);
    assertThat(online.get("online").asBoolean()).isTrue();
    assertThat(Instant.parse(online.get("onlineSince").asText())).isEqualTo(wentOnline);
    assertThat(online.get("streamHealthy").asBoolean()).isFalse();

    advance(Duration.ofMinutes(1));
    JsonNode again = ok(goOnline(driver, true), HttpStatus.OK);
    assertThat(Instant.parse(again.get("onlineSince").asText())).isEqualTo(wentOnline);

    JsonNode offline = ok(goOnline(driver, false), HttpStatus.OK);
    assertThat(offline.get("online").asBoolean()).isFalse();
    assertThat(offline.get("onlineSince").isNull()).isTrue();
    ok(goOnline(driver, false), HttpStatus.OK);
    assertThat(put("/api/v1/driver/availability", Map.of(), driver.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "gates: no profile 409, not approved, suspended for expiry (with reason), no vehicle")
  void shouldRefuseGoingOnlineWhenAGateFails() {
    Account rider = registerWithoutPhoto("+963936000021", "Just A Rider");
    assertThat(get("/api/v1/driver/availability", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(goOnline(rider, true).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

    Account applicant = registerApplicant("+963936000022", "Applicant");
    submitApplication(applicant, "AV2");
    JsonNode pending = availability(applicant);
    assertThat(pending.get("canGoOnline").asBoolean()).isFalse();
    assertThat(pending.get("cannotGoOnlineReason").asText()).isEqualTo("not_approved");
    assertThat(goOnline(applicant, true).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

    Account suspended = approvedDriver("+963936000023", "AV3", economy, admin);
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'document_expired'"
            + " WHERE user_id = ? AND role = 'driver'",
        suspended.userId());
    JsonNode suspendedState = availability(suspended);
    assertThat(suspendedState.get("canGoOnline").asBoolean()).isFalse();
    assertThat(suspendedState.get("cannotGoOnlineReason").asText()).isEqualTo("role_suspended");
    assertThat(suspendedState.get("suspensionReason").asText()).isEqualTo("document_expired");
    ResponseEntity<JsonNode> refused = goOnline(suspended, true);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(refused.getBody().get("message").asText()).contains("suspended");
    // Going offline is always allowed (no active rides before M7).
    ok(goOnline(suspended, false), HttpStatus.OK);

    Account noVehicle = approvedDriver("+963936000024", "AV4", economy, admin);
    jdbcTemplate.update(
        "UPDATE vehicles SET is_active = false WHERE driver_user_id = ?", noVehicle.userId());
    JsonNode vehicleless = availability(noVehicle);
    assertThat(vehicleless.get("cannotGoOnlineReason").asText()).isEqualTo("no_active_vehicle");
    assertThat(vehicleless.get("suspensionReason").isNull()).isTrue();
    assertThat(goOnline(noVehicle, true).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("REST fallback: offline/non-driver 409, invalid 400, newest wins, older ignored")
  void shouldIngestLocationsOverRest() {
    Account rider = registerWithoutPhoto("+963936000031", "Rider");
    assertThat(postSamples(rider, List.of(sample(33.5, 36.3, CLOCK.instant()))).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    Account driver = approvedDriver("+963936000032", "AV5", economy, admin);
    assertThat(postSamples(driver, List.of(sample(33.5, 36.3, CLOCK.instant()))).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    ok(goOnline(driver, true), HttpStatus.OK);

    assertThat(postSamples(driver, List.of(sample(91, 36.3, CLOCK.instant()))).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(postSamples(driver, List.of()).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    List<Map<String, Object>> tooMany = new ArrayList<>();
    for (int i = 0; i < 21; i++) {
      tooMany.add(sample(33.5, 36.3, CLOCK.instant()));
    }
    assertThat(postSamples(driver, tooMany).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            postSamples(
                    driver,
                    List.of(
                        Map.of(
                            "lat",
                            33.5,
                            "lng",
                            36.3,
                            "headingDeg",
                            360,
                            "recordedAt",
                            CLOCK.instant().toString())))
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    Instant t0 = CLOCK.instant().minusSeconds(15);
    ok(
        postSamples(
            driver,
            List.of(
                sample(33.50, 36.30, t0.plusSeconds(5)),
                sample(33.51, 36.31, t0.plusSeconds(10)),
                sample(33.49, 36.29, t0))),
        HttpStatus.ACCEPTED);
    assertThat(storedRecordedAt(driver.userId())).isEqualTo(t0.plusSeconds(10));

    ok(postSamples(driver, List.of(sample(1, 1, t0.plusSeconds(1)))), HttpStatus.ACCEPTED);
    assertThat(storedRecordedAt(driver.userId())).isEqualTo(t0.plusSeconds(10));
    Map<String, Object> position =
        jdbcTemplate.queryForMap(
            "SELECT ST_Y(position) AS lat, ST_X(position) AS lng, heading_deg"
                + " FROM driver_locations WHERE user_id = ?",
            driver.userId());
    assertThat((Double) position.get("lat")).isEqualTo(33.51);
    assertThat((Double) position.get("lng")).isEqualTo(36.31);
    assertThat(position.get("heading_deg")).isNull();
  }

  @Test
  @DisplayName("stale detection on a controlled clock: silence > 30 s flags, samples clear it")
  void shouldDetectStaleStreams() {
    Account driver = approvedDriver("+963936000041", "AV6", economy, admin);
    Account other = approvedDriver("+963936000042", "AV7", economy, admin);
    ok(goOnline(driver, true), HttpStatus.OK);
    ok(goOnline(other, true), HttpStatus.OK);
    assertThat(driverLocationService.streamingDriverIds()).isEmpty();

    ok(postSamples(driver, List.of(sample(33.5, 36.3, CLOCK.instant()))), HttpStatus.ACCEPTED);
    ok(postSamples(other, List.of(sample(33.6, 36.4, CLOCK.instant()))), HttpStatus.ACCEPTED);
    assertThat(availability(driver).get("streamHealthy").asBoolean()).isTrue();
    assertThat(driverLocationService.streamingDriverIds())
        .containsExactlyInAnyOrder(driver.userId(), other.userId());

    // Exactly at the 30 s boundary the driver still counts as streaming.
    advance(Duration.ofSeconds(30));
    assertThat(driverLocationService.isStreamHealthy(driver.userId())).isTrue();

    advance(Duration.ofSeconds(1));
    ok(postSamples(other, List.of(sample(33.6, 36.4, CLOCK.instant()))), HttpStatus.ACCEPTED);
    assertThat(availability(driver).get("streamHealthy").asBoolean()).isFalse();
    assertThat(driverLocationService.streamingDriverIds()).containsExactly(other.userId());

    // Samples resume → offerable again.
    ok(postSamples(driver, List.of(sample(33.5, 36.3, CLOCK.instant()))), HttpStatus.ACCEPTED);
    assertThat(availability(driver).get("streamHealthy").asBoolean()).isTrue();

    // Offline drivers are never streaming, even with a fresh sample.
    ok(goOnline(other, false), HttpStatus.OK);
    assertThat(driverLocationService.streamingDriverIds()).containsExactly(driver.userId());
    assertThat(availability(other).get("streamHealthy").isNull()).isTrue();
  }
}
