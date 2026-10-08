package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.RideDispatchService;
import com.labby.backend.service.RideTrackingService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.convention.TestBean;

/**
 * Shared fixture of the M7 ride-loop integration tests: an active "Damascus" region (boundary lng
 * 36.2..36.4 × lat 33.4..33.6, SYP, grace 2 min / fee 2.00, wait grace 5 min, pickup-fee threshold
 * 10 km) with one Economy service type (1.00 base + 0.50/km + 0.10/min, minimum 1.50), a
 * controllable clock, and helpers that drive real API calls. The dispatcher and the monitor never
 * tick on their own in tests ({@link AbstractIntegrationTest}); tests advance them explicitly.
 * Routing takes the straight-line fallback (approximate) — the OSRM URL points at a closed port.
 */
abstract class AbstractRideIntegrationTest extends AbstractOnboardingIntegrationTest {

  /** Inside the region: a pickup and a destination ~2.2 km apart. */
  protected static final double PICKUP_LAT = 33.50;

  protected static final double PICKUP_LNG = 36.30;
  protected static final double DEST_LAT = 33.51;
  protected static final double DEST_LNG = 36.31;

  protected static final DocumentExpiryIntegrationTest.MutableClock CLOCK =
      new DocumentExpiryIntegrationTest.MutableClock();

  @TestBean private Clock clock;

  @Autowired protected RideDispatchService rideDispatchService;
  @Autowired protected RideTrackingService rideTrackingService;

  protected String admin;
  protected UUID regionId;
  protected UUID economy;
  private int phoneSequence;
  private int plateSequence;

  static Clock clock() {
    return CLOCK;
  }

  @BeforeEach
  void seedRideRegion() {
    CLOCK.set(Instant.now().truncatedTo(ChronoUnit.MICROS));
    phoneSequence = 0;
    plateSequence = 0;
    admin = registerSuperAdmin("+963937900000");
    regionId =
        jdbcTemplate.queryForObject(
            "INSERT INTO regions (name, state, currency, emergency_number, boundary,"
                + " cancellation_grace_min, cancellation_fee, wait_grace_min, wait_per_min_rate,"
                + " pickup_fee_threshold_km, pickup_fee_per_km, surge_cap) VALUES ('Damascus"
                + " Rides', 'active', 'SYP', '112', ST_GeomFromText('POLYGON((36.2 33.4, 36.4"
                + " 33.4, 36.4 33.6, 36.2 33.6, 36.2 33.4))', 4326), 2, 2.00, 5, 0.25, 10.0, 0.50,"
                + " 2.00) RETURNING region_id",
            UUID.class);
    economy =
        jdbcTemplate.queryForObject(
            "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
                + " per_min_rate, minimum_fare) VALUES (?, 'Economy', 'اقتصادي', 1.00, 0.50, 0.10,"
                + " 1.50) RETURNING service_type_id",
            UUID.class,
            regionId);
  }

  // ---- parties ------------------------------------------------------------------------------

  /** A fresh rider account (registration grants the rider role). */
  protected Account rider() {
    return registerWithoutPhoto(nextPhone(), "Rana Rider");
  }

  /** An approved Economy driver, online, streaming from the given position. */
  protected Account driverAt(double lat, double lng) {
    Account driver = approvedDriver(nextPhone(), nextPlate(), economy, admin);
    ok(put("/api/v1/driver/availability", Map.of("online", true), driver.token()), HttpStatus.OK);
    position(driver, lat, lng);
    return driver;
  }

  /**
   * One location sample (REST fallback, realtime-v1) one second after the previous clock time — a
   * sample is only newer than the stored fix when its time is later.
   */
  protected void position(Account driver, double lat, double lng) {
    advance(Duration.ofSeconds(1));
    ok(
        post(
            "/api/v1/driver/locations",
            Map.of("samples", List.of(sample(lat, lng, CLOCK.instant()))),
            driver.token()),
        HttpStatus.ACCEPTED);
  }

  protected static Map<String, Object> sample(double lat, double lng, Instant recordedAt) {
    return Map.of("lat", lat, "lng", lng, "recordedAt", recordedAt.toString());
  }

  // ---- rider calls ---------------------------------------------------------------------------

  protected static Map<String, Object> place(double lat, double lng) {
    return Map.of("lat", lat, "lng", lng);
  }

  protected Map<String, Object> booking(List<Map<String, Object>> stops) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("stops", stops);
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", "cash");
    return body;
  }

  protected ResponseEntity<JsonNode> tryBook(Account rider, Map<String, Object> body) {
    return post("/api/v1/rides", body, rider.token());
  }

  /** Books the standard pickup → destination ride; returns the ride id. */
  protected UUID book(Account rider) {
    JsonNode ride = ok(tryBook(rider, booking(List.of())), HttpStatus.CREATED);
    assertThat(ride.get("state").asText()).isEqualTo("requested");
    return UUID.fromString(ride.get("id").asText());
  }

  protected JsonNode riderRide(Account rider, UUID rideId) {
    return ok(get("/api/v1/rides/" + rideId, rider.token()), HttpStatus.OK);
  }

  // ---- driver calls --------------------------------------------------------------------------

  /** The driver's open offer (asserting there is one). */
  protected JsonNode openOffer(Account driver) {
    return ok(get("/api/v1/driver/offers/open", driver.token()), HttpStatus.OK);
  }

  protected boolean hasOpenOffer(Account driver) {
    return get("/api/v1/driver/offers/open", driver.token()).getStatusCode() == HttpStatus.OK;
  }

  protected ResponseEntity<JsonNode> accept(Account driver, String offerId) {
    return post("/api/v1/driver/offers/" + offerId + "/accept", null, driver.token());
  }

  protected ResponseEntity<JsonNode> driverAction(Account driver, UUID rideId, String action) {
    return post("/api/v1/driver/rides/" + rideId + "/" + action, null, driver.token());
  }

  /** Dispatch → the driver's offer → accept; returns the accepted ride (driver view). */
  protected JsonNode dispatchAndAccept(UUID rideId, Account driver) {
    dispatch();
    JsonNode offer = openOffer(driver);
    assertThat(offer.get("rideId").asText()).isEqualTo(rideId.toString());
    return ok(accept(driver, offer.get("id").asText()), HttpStatus.OK);
  }

  /** Accepted → arrived (driver at the pickup) → in progress. */
  protected void arriveAndStart(UUID rideId, Account driver) {
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
  }

  // ---- engine + clock ------------------------------------------------------------------------

  protected int dispatch() {
    return rideDispatchService.dispatchDue();
  }

  protected void advance(Duration duration) {
    CLOCK.set(CLOCK.instant().plus(duration));
  }

  protected String stateOf(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT state FROM rides WHERE ride_id = ?", String.class, rideId);
  }

  protected List<String> offerResponses(UUID rideId) {
    List<String> responses = new ArrayList<>();
    jdbcTemplate.query(
        "SELECT response FROM ride_offers WHERE ride_id = ? ORDER BY sequence",
        row -> {
          responses.add(row.getString(1));
        },
        rideId);
    return responses;
  }

  protected ResponseEntity<JsonNode> put(String url, Object body, String token) {
    HttpHeaders headers = bearer(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return restTemplate.exchange(
        url, HttpMethod.PUT, new HttpEntity<>(body, headers), JsonNode.class);
  }

  protected ResponseEntity<JsonNode> delete(String url, String token) {
    return restTemplate.exchange(
        url, HttpMethod.DELETE, new HttpEntity<>(bearer(token)), JsonNode.class);
  }

  /** The machine error code of a failed response. */
  protected static String code(ResponseEntity<JsonNode> response) {
    return response.getBody() == null ? null : response.getBody().path("code").asText(null);
  }

  private String nextPhone() {
    return "+9639379%05d".formatted(++phoneSequence);
  }

  private String nextPlate() {
    return "RD-" + (++plateSequence);
  }
}
