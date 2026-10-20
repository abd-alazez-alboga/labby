package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * V1 audit W40 (owner ruling 2026-10-20, UC-R-06 step 3): the rider is notified when the expected
 * arrival slips by 5+ minutes over the last one they were told of, at most once per 5 minutes; the
 * in-ride ETA routes through the stops not yet visited.
 */
class EtaDelayNoticeIntegrationTest extends AbstractRideIntegrationTest {

  /** Far inside the region's south-west corner (~11 km from the pickup). */
  private static final double FAR_LAT = 33.42;

  private static final double FAR_LNG = 36.22;

  @Test
  @DisplayName("W40: a 5+ min slip of the pickup ETA notifies the rider once per 5 minutes")
  void shouldNotifyRiderOfASignificantDelay() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    refreshEta(); // the baseline: the driver is at the pickup
    assertThat(delayNotices(rider.userId())).isEmpty();

    // The driver ends up far away (a reroute): the expected arrival slips by far more than 5 min.
    position(driver, FAR_LAT, FAR_LNG);
    refreshEta();
    assertThat(delayNotices(rider.userId())).containsExactly("pickup");

    // Still slipping a minute later — but within 5 minutes of the last notice: no new push.
    position(driver, 33.41, 36.21);
    refreshEta();
    assertThat(delayNotices(rider.userId())).hasSize(1);

    // After the rest period the driver made up the time (back near the pickup): the arrival is
    // earlier than the last notified one, so nothing is sent.
    advance(Duration.ofMinutes(6));
    position(driver, PICKUP_LAT, PICKUP_LNG);
    refreshEta();
    assertThat(delayNotices(rider.userId())).hasSize(1);

    // Stuck far away for another 6+ minutes: the arrival slips again → a second notice.
    position(driver, FAR_LAT, FAR_LNG);
    advance(Duration.ofMinutes(6));
    position(driver, FAR_LAT, FAR_LNG);
    refreshEta();
    assertThat(delayNotices(rider.userId())).containsExactly("pickup", "pickup");
  }

  @Test
  @DisplayName("W40: the in-ride ETA routes through a stop not yet visited, not after it")
  void shouldRouteThroughRemainingStops() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId =
        UUID.fromString(
            ok(tryBook(rider, booking(List.of(place(FAR_LAT, FAR_LNG)))), HttpStatus.CREATED)
                .get("id")
                .asText());
    dispatchAndAccept(rideId, driver);
    arriveAndStart(rideId, driver);
    refreshEta();
    // At the pickup, the ETA routes pickup → stop (~11 km) → destination (~12 km).
    int viaStop = etaSeconds(rideId);

    // The driver reaches the stop, then comes back near the start: the stop is visited, so only
    // the short leg to the destination (~1.4 km) remains.
    position(driver, FAR_LAT, FAR_LNG);
    position(driver, PICKUP_LAT, PICKUP_LNG);
    refreshEta();
    assertThat(etaSeconds(rideId)).isLessThan(viaStop / 5);
  }

  private void refreshEta() {
    advance(Duration.ofSeconds(31)); // past the 30 s ETA refresh
    rideTrackingService.monitor();
  }

  private int etaSeconds(UUID rideId) {
    return jdbcTemplate.queryForObject(
        "SELECT eta_seconds FROM rides WHERE ride_id = ?", Integer.class, rideId);
  }

  private List<String> delayNotices(UUID riderUserId) {
    return jdbcTemplate.queryForList(
        "SELECT params ->> 'phase' FROM notification_outbox WHERE user_id = ? AND event ="
            + " 'ride.eta_delayed' ORDER BY created_at",
        String.class,
        riderUserId);
  }
}
