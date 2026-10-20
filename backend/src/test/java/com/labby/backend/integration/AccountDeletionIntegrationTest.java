package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.util.RbacIds;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * UC-S-07 delete account (review V1 H1 / W13 / W9): the E1 active-ride and E2 debt-below-floor
 * gates and the last-Super-Admin guard answer 409 with their codes BEFORE the 2FA code is used; a
 * deletion ends pending activity like a suspension (scheduled rides, gathering shared rides, the
 * online flag).
 */
class AccountDeletionIntegrationTest extends AbstractTrustIntegrationTest {

  @Test
  @DisplayName("E1: a rider with a requested or accepted ride, and its driver, get 409 active_ride")
  void shouldRefuseDeletionOnAnActiveRide() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);

    // Pre-acceptance is an active ride (rides-v1 UC-R-04 E4) — the code is kept for later.
    String riderCode = twoFactorCode(rider);
    assertRefused(deleteAccount(rider, riderCode), "active_ride");

    dispatchAndAccept(rideId, driver);
    assertRefused(deleteAccount(rider, riderCode), "active_ride");
    String driverCode = twoFactorCode(driver);
    assertRefused(deleteAccount(driver, driverCode), "active_ride");
    assertThat(accountState(rider.userId())).isEqualTo("active");
    assertThat(accountState(driver.userId())).isEqualTo("active");

    // Once the ride is over (and the cash settled), the SAME codes delete both accounts.
    arriveAndStart(rideId, driver);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertRefused(deleteAccount(driver, driverCode), "active_ride"); // cash still pending
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(deleteAccount(rider, riderCode).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(deleteAccount(driver, driverCode).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(accountState(rider.userId())).isEqualTo("deleted");
  }

  @Test
  @DisplayName("E2: a driver at/below the region floor gets 409 debt_below_floor until settled")
  void shouldRefuseDeletionBelowTheFloor() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    jdbcTemplate.update(
        "UPDATE regions SET driver_balance_floor = -10 WHERE region_id = ?", regionId);
    settle(driver.userId(), "10.00", "pay_out");

    String code = twoFactorCode(driver);
    assertRefused(deleteAccount(driver, code), "debt_below_floor");
    assertThat(accountState(driver.userId())).isEqualTo("active");

    settle(driver.userId(), "10.00", "pay_in");
    assertThat(deleteAccount(driver, code).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
  }

  @Test
  @DisplayName(
      "W13: deletion cancels the rider's scheduled ride, ends its gathering shared ride and takes"
          + " the driver offline")
  void shouldEndPendingActivityOnDeletion() {
    Account scheduler = rider();
    Account creator = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Map<String, Object> scheduling = new LinkedHashMap<>(booking(List.of()));
    scheduling.put("scheduledAt", CLOCK.instant().plus(Duration.ofDays(2)).toString());
    UUID scheduled =
        UUID.fromString(
            ok(post("/api/v1/scheduled-rides", scheduling, scheduler.token()), HttpStatus.CREATED)
                .get("id")
                .asText());
    UUID gathering =
        UUID.fromString(
            ok(post("/api/v1/shared-rides", sharedBooking(), creator.token()), HttpStatus.CREATED)
                .get("rideId")
                .asText());

    for (Account account : List.of(scheduler, creator, driver)) {
      String code = twoFactorCode(account);
      assertThat(deleteAccount(account, code).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    assertThat(stateOf(scheduled)).startsWith("cancelled");
    assertThat(stateOf(gathering)).isNotEqualTo("gathering");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM shared_ride_members WHERE ride_id = ? AND rider_user_id = ?",
                String.class,
                gathering,
                creator.userId()))
        .isNotEqualTo("joined");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?",
                Boolean.class,
                driver.userId()))
        .isFalse();
  }

  @Test
  @DisplayName("W9: the last active Super Admin cannot delete its own account (409)")
  void shouldRefuseDeletingTheLastActiveSuperAdmin() {
    String phone = "+963937650099";
    String token = registerSuperAdmin(phone);
    UUID userId =
        jdbcTemplate.queryForObject("SELECT user_id FROM users WHERE phone = ?", UUID.class, phone);
    // Every other Super Admin is deactivated: this one is the last.
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended' WHERE admin_role_id = ? AND user_id <> ?",
        RbacIds.SUPER_ADMIN_ROLE_ID,
        userId);
    Account sole = new Account(userId, token, phone);

    String code = twoFactorCode(sole);
    assertRefused(deleteAccount(sole, code), "last_super_admin");
    assertThat(accountState(userId)).isEqualTo("active");

    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'active' WHERE admin_role_id = ?",
        RbacIds.SUPER_ADMIN_ROLE_ID);
    assertThat(deleteAccount(sole, code).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
  }

  // ---- helpers -------------------------------------------------------------------------------

  private ResponseEntity<JsonNode> deleteAccount(Account account, String code) {
    return restTemplate.exchange(
        "/api/v1/users/me",
        HttpMethod.DELETE,
        new HttpEntity<>(Map.of("otpCode", code), bearer(account.token())),
        JsonNode.class);
  }

  /** A fresh 2FA code (the registration code's resend cooldown aged away first). */
  private String twoFactorCode(Account account) {
    ageOtpCodes(account.phone());
    return requestTwoFactorCode(account.token(), account.phone());
  }

  private void assertRefused(ResponseEntity<JsonNode> response, String expectedCode) {
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(response)).isEqualTo(expectedCode);
  }

  private String accountState(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT state FROM users WHERE user_id = ?", String.class, userId);
  }

  private void settle(UUID driverUserId, String amount, String direction) {
    ok(
        post(
            "/api/v1/admin/drivers/" + driverUserId + "/settlements",
            Map.of("amount", amount, "direction", direction, "currency", "SYP"),
            admin),
        HttpStatus.CREATED);
  }

  private Map<String, Object> sharedBooking() {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("pickup", place(PICKUP_LAT, PICKUP_LNG));
    body.put("destination", place(DEST_LAT, DEST_LNG));
    body.put("serviceTypeId", economy.toString());
    body.put("paymentMethod", "cash");
    body.put("totalSeats", 3);
    body.put("partySize", 1);
    body.put("departure", Map.of("mode", "when_full"));
    return body;
  }
}
