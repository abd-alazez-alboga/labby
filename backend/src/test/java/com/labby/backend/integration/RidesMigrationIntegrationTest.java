package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * M7-T1 acceptance: V10 migrates cleanly and the ride-loop invariants hold at the DATABASE level —
 * the RIDE-02 states and their timestamps, a driver bound exactly from acceptance on, ≤ 3 stops,
 * one active ride per rider, sequential dispatch (one open offer per ride and per driver), the
 * RIDE-07 cancellation rules (reason required, driver cancellations never charge except no-show),
 * payment status only after completion, a fare total equal to its stored components (PRC-04), and
 * the rider extras (unique saved-place names, comfort/matching defaults).
 */
class RidesMigrationIntegrationTest extends AbstractIntegrationTest {

  @Autowired private JdbcTemplate jdbcTemplate;

  private final List<UUID> createdUsers = new ArrayList<>();
  private UUID regionId;
  private UUID serviceTypeId;
  private UUID rider;
  private UUID driver;
  private UUID vehicle;

  @BeforeEach
  void seedRegionAndParties() {
    regionId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO regions (region_id, name, currency) VALUES (?, ?, 'SYP')",
        regionId,
        "Rides IT " + regionId);
    serviceTypeId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO service_types (service_type_id, region_id, name_en, name_ar, base_fare,"
            + " per_km_rate, per_min_rate, minimum_fare) VALUES (?, ?, 'Economy', 'اقتصادي', 1.00,"
            + " 0.30, 0.05, 1.50)",
        serviceTypeId,
        regionId);
    rider = newUser();
    driver = newUser();
    vehicle = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Kia', 'Rio', 2018, 'White', 'DM-1', 4,"
            + " 'approved', true)",
        vehicle,
        driver);
  }

  @AfterEach
  void cleanOwnRows() {
    jdbcTemplate.update(
        "DELETE FROM fares WHERE ride_id IN (SELECT ride_id FROM rides WHERE region_id = ?)",
        regionId);
    jdbcTemplate.update(
        "DELETE FROM ride_traces WHERE ride_id IN (SELECT ride_id FROM rides WHERE region_id = ?)",
        regionId);
    jdbcTemplate.update(
        "DELETE FROM ride_offers WHERE ride_id IN (SELECT ride_id FROM rides WHERE region_id = ?)",
        regionId);
    jdbcTemplate.update("DELETE FROM rides WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM service_types WHERE region_id = ?", regionId);
    jdbcTemplate.update("DELETE FROM regions WHERE region_id = ?", regionId);
    for (UUID userId : createdUsers) {
      jdbcTemplate.update("DELETE FROM saved_locations WHERE rider_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM rider_preferences WHERE user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM vehicles WHERE driver_user_id = ?", userId);
      jdbcTemplate.update("DELETE FROM users WHERE user_id = ?", userId);
    }
    createdUsers.clear();
  }

  @Test
  @DisplayName("regions get a time zone defaulting to Asia/Damascus; ride geometry is SRID 4326")
  void shouldMigrateSchema() {
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT time_zone FROM regions WHERE region_id = ?", String.class, regionId))
        .isEqualTo("Asia/Damascus");
    assertThat(
            jdbcTemplate.queryForList(
                "SELECT f_table_name || '.' || f_geometry_column FROM geometry_columns WHERE srid ="
                    + " 4326 AND f_table_name IN ('rides', 'ride_traces', 'saved_locations')",
                String.class))
        .containsExactlyInAnyOrder(
            "rides.pickup",
            "rides.destination",
            "ride_traces.position",
            "saved_locations.position");
  }

  @Test
  @DisplayName("RIDE-02: a ride walks the happy path; the driver is bound from acceptance on")
  void shouldWalkHappyPath() {
    UUID ride = insertRide(rider);
    assertThat(stateOf(ride)).isEqualTo("requested");

    jdbcTemplate.update(
        "UPDATE rides SET state = 'offering', offering_at = now() WHERE ride_id = ?", ride);
    // Accepting without binding a driver + vehicle is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET state = 'accepted', accepted_at = now() WHERE ride_id = ?",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_driver_bound");
    // A state without its timestamp is refused.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET state = 'accepted', driver_user_id = ?, vehicle_id = ?"
                        + " WHERE ride_id = ?",
                    driver,
                    vehicle,
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_state_timestamp");

    jdbcTemplate.update(
        "UPDATE rides SET state = 'accepted', accepted_at = now(), driver_user_id = ?,"
            + " vehicle_id = ?, cancellation_grace_ends_at = now() + interval '2 minutes'"
            + " WHERE ride_id = ?",
        driver,
        vehicle,
        ride);
    jdbcTemplate.update(
        "UPDATE rides SET state = 'driver_arrived', driver_arrived_at = now() WHERE ride_id = ?",
        ride);
    jdbcTemplate.update(
        "UPDATE rides SET state = 'in_progress', started_at = now() WHERE ride_id = ?", ride);

    // Payment status exists only once the ride is completed.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET payment_status = 'pending' WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_payment_status");
    jdbcTemplate.update(
        "UPDATE rides SET state = 'completed', completed_at = now(), payment_status = 'pending'"
            + " WHERE ride_id = ?",
        ride);
    // Settled payment carries its moment.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET payment_status = 'paid_cash' WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_payment_confirmed");
    jdbcTemplate.update(
        "UPDATE rides SET payment_status = 'paid_cash', payment_confirmed_at = now()"
            + " WHERE ride_id = ?",
        ride);
    assertThat(stateOf(ride)).isEqualTo("completed");

    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET state = 'teleported' WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("violates check constraint");
    // The unknown value is outside the RIDE-02 state list itself (the other checks also refuse it).
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_rides_state'",
                String.class))
        .contains("requested", "no_driver_found")
        .doesNotContain("teleported");
  }

  @Test
  @DisplayName("RIDE-01/05: at most 3 intermediate stops")
  void shouldCapStops() {
    UUID ride = insertRide(rider);
    jdbcTemplate.update(
        "UPDATE rides SET stops = '[{\"lat\":33.5,\"lng\":36.3},{\"lat\":33.51,\"lng\":36.31},"
            + "{\"lat\":33.52,\"lng\":36.32}]' WHERE ride_id = ?",
        ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET stops = '[{},{},{},{}]' WHERE ride_id = ?", ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_stops");
  }

  @Test
  @DisplayName("UC-R-04 E4: one active ride per rider; a finished ride frees the slot")
  void shouldAllowOneActiveRidePerRider() {
    UUID first = insertRide(rider);
    assertThatThrownBy(() -> insertRide(rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_rides_rider_active");

    jdbcTemplate.update(
        "UPDATE rides SET state = 'no_driver_found', no_driver_found_at = now() WHERE ride_id = ?",
        first);
    UUID retry = insertRide(rider);
    jdbcTemplate.update("UPDATE rides SET retry_of_ride_id = ? WHERE ride_id = ?", first, retry);
    // A ride has one origin at most: a retry is not also a re-dispatch.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET redispatch_of_ride_id = ? WHERE ride_id = ?", first, retry))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_single_origin");
  }

  @Test
  @DisplayName("RIDE-03: sequential dispatch — one open offer per ride and per driver")
  void shouldKeepDispatchSequential() {
    UUID ride = insertRide(rider);
    UUID firstOffer = insertOffer(ride, driver, vehicle, 1);

    UUID secondDriver = newUser();
    UUID secondVehicle = insertVehicle(secondDriver, "DM-2");
    assertThatThrownBy(() -> insertOffer(ride, secondDriver, secondVehicle, 2))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ride_offers_pending_ride");

    // The same driver cannot hold an open offer for another ride at the same time.
    UUID otherRide = insertRide(newUser());
    assertThatThrownBy(() -> insertOffer(otherRide, driver, vehicle, 1))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ride_offers_pending_driver");

    // An answered offer needs its moment; once answered, the next candidate can be offered.
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE ride_offers SET response = 'declined' WHERE ride_offer_id = ?",
                    firstOffer))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ride_offers_responded");
    jdbcTemplate.update(
        "UPDATE ride_offers SET response = 'timeout', responded_at = now() WHERE ride_offer_id = ?",
        firstOffer);
    insertOffer(ride, secondDriver, secondVehicle, 2);

    // A driver is offered a given ride only once.
    jdbcTemplate.update(
        "UPDATE ride_offers SET response = 'declined', responded_at = now() WHERE ride_id = ?"
            + " AND response IS NULL",
        ride);
    assertThatThrownBy(() -> insertOffer(ride, driver, vehicle, 3))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_ride_offers_driver");
  }

  @Test
  @DisplayName("RIDE-07: cancellations need a reason; driver cancellations charge only a no-show")
  void shouldEnforceCancellationRules() {
    UUID ride = insertAcceptedRide(rider);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET state = 'cancelled_by_driver', cancelled_at = now()"
                        + " WHERE ride_id = ?",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_cancellation");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rides SET state = 'cancelled_by_driver', cancelled_at = now(),"
                        + " cancellation_reason = 'vehicle_issue', cancellation_fee = 2.00"
                        + " WHERE ride_id = ?",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rides_cancellation_fee");
    jdbcTemplate.update(
        "UPDATE rides SET state = 'cancelled_by_driver', cancelled_at = now(),"
            + " cancellation_reason = 'rider_no_show', cancellation_fee = 2.00 WHERE ride_id = ?",
        ride);

    UUID riderCancelled = insertAcceptedRide(newUser());
    jdbcTemplate.update(
        "UPDATE rides SET state = 'cancelled_by_rider', cancelled_at = now(),"
            + " cancellation_reason = 'changed_mind', cancellation_fee = 2.00 WHERE ride_id = ?",
        riderCancelled);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT cancellation_fee FROM rides WHERE ride_id = ?",
                String.class,
                riderCancelled))
        .isEqualTo("2.00");
  }

  @Test
  @DisplayName("PRC-04: a fare's total must equal its stored components; traces are typed")
  void shouldStoreConsistentFares() {
    UUID ride = insertAcceptedRide(rider);
    jdbcTemplate.update(
        "INSERT INTO ride_traces (ride_id, phase, position, recorded_at) VALUES"
            + " (?, 'in_ride', ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), now())",
        ride);
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "INSERT INTO ride_traces (ride_id, phase, position, recorded_at) VALUES"
                        + " (?, 'parked', ST_SetSRID(ST_MakePoint(36.29, 33.51), 4326), now())",
                    ride))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_ride_traces_phase");

    assertThatThrownBy(() -> insertFare(ride, "9.99"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_fares_total");
    // 1.00 base + 1.50 distance + 0.50 time + 0.75 surcharge = 3.75
    insertFare(ride, "3.75");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT total FROM fares WHERE ride_id = ?", String.class, ride))
        .isEqualTo("3.75");
  }

  @Test
  @DisplayName("UC-R-01..03: saved-place names unique per rider (any case); preference defaults")
  void shouldKeepRiderExtras() {
    insertSavedLocation(rider, "Home");
    assertThatThrownBy(() -> insertSavedLocation(rider, "HOME"))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("uq_saved_locations_rider_name");
    insertSavedLocation(newUser(), "Home");

    jdbcTemplate.update("INSERT INTO rider_preferences (user_id) VALUES (?)", rider);
    assertThat(
            jdbcTemplate.queryForMap(
                "SELECT temperature, conversation, music, pickup_distance_mode"
                    + " FROM rider_preferences WHERE user_id = ?",
                rider))
        .containsEntry("temperature", "no_preference")
        .containsEntry("conversation", "no_preference")
        .containsEntry("music", "no_preference")
        .containsEntry("pickup_distance_mode", "nearby_only");
    assertThatThrownBy(
            () ->
                jdbcTemplate.update(
                    "UPDATE rider_preferences SET music = 'heavy_metal' WHERE user_id = ?", rider))
        .isInstanceOf(DataIntegrityViolationException.class)
        .hasMessageContaining("ck_rider_preferences_music");
  }

  private UUID insertRide(UUID riderId) {
    UUID rideId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO rides (ride_id, rider_user_id, region_id, service_type_id, pickup,"
            + " destination, payment_method, pickup_distance_mode, currency, estimate_total,"
            + " estimate_distance_m, estimate_duration_s, estimate_components) VALUES (?, ?, ?, ?,"
            + " ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326),"
            + " ST_SetSRID(ST_MakePoint(36.30, 33.52), 4326), 'cash', 'nearby_only', 'SYP', 3.75,"
            + " 5000, 600, '{}')",
        rideId,
        riderId,
        regionId,
        serviceTypeId);
    return rideId;
  }

  private UUID insertAcceptedRide(UUID riderId) {
    UUID rideId = insertRide(riderId);
    jdbcTemplate.update(
        "UPDATE rides SET state = 'accepted', offering_at = now(), accepted_at = now(),"
            + " driver_user_id = ?, vehicle_id = ? WHERE ride_id = ?",
        driver,
        vehicle,
        rideId);
    return rideId;
  }

  private UUID insertOffer(UUID rideId, UUID driverId, UUID vehicleId, int sequence) {
    UUID offerId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO ride_offers (ride_offer_id, ride_id, driver_user_id, vehicle_id, sequence,"
            + " pickup_distance_m, pickup_eta_s, expires_at) VALUES (?, ?, ?, ?, ?, 900, 180,"
            + " now() + interval '15 seconds')",
        offerId,
        rideId,
        driverId,
        vehicleId,
        sequence);
    return offerId;
  }

  private void insertFare(UUID rideId, String total) {
    jdbcTemplate.update(
        "INSERT INTO fares (ride_id, currency, distance_m, duration_s, base_fare, distance_fare,"
            + " time_fare, surcharge_percent, surcharge_amount, total) VALUES (?, 'SYP', 5000,"
            + " 600, 1.00, 1.50, 0.50, 25, 0.75, ?::numeric)",
        rideId,
        total);
  }

  private UUID insertVehicle(UUID driverId, String plate) {
    UUID vehicleId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO vehicles (vehicle_id, driver_user_id, make, model, year, color, plate, seats,"
            + " review_status, is_active) VALUES (?, ?, 'Hyundai', 'Accent', 2019, 'Black', ?, 4,"
            + " 'approved', true)",
        vehicleId,
        driverId,
        plate);
    return vehicleId;
  }

  private void insertSavedLocation(UUID riderId, String name) {
    jdbcTemplate.update(
        "INSERT INTO saved_locations (rider_user_id, name, position) VALUES"
            + " (?, ?, ST_SetSRID(ST_MakePoint(36.28, 33.50), 4326))",
        riderId,
        name);
  }

  private String stateOf(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT state FROM rides WHERE ride_id = ?", String.class, rideId);
  }

  private UUID newUser() {
    UUID userId = UUID.randomUUID();
    jdbcTemplate.update(
        "INSERT INTO users (user_id, phone, password_hash, name, terms_accepted_at) VALUES"
            + " (?, ?, 'x', 'Rides Test User', now())",
        userId,
        "+9638%08d".formatted(Math.floorMod(userId.getMostSignificantBits(), 100_000_000L)));
    createdUsers.add(userId);
    return userId;
  }
}
