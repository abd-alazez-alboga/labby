package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.enums.ClientType;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M11-T2 admin suspension machinery (USR-04/06, UC-A-13/14) through the API: whole-account
 * suspension ("deactivate") refusing every rider/driver feature with 403 {@code account_suspended}
 * while login and the profile keep working; manual role suspension with a mandatory note (replacing
 * an automatic reason, never twice); reactivation; admin accounts out of scope; every change
 * audited and notified; permission gating ({@code users:view} / {@code users:suspend}).
 */
class TrustAdminIntegrationTest extends AbstractTrustIntegrationTest {

  @Test
  @DisplayName(
      "USR-06 deactivate: every rider/driver feature answers 403 account_suspended; login,"
          + " profile and notifications still work; reactivation restores access")
  void shouldEnforceWholeAccountSuspension() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String support = supportAdmin("+963937650031");
    String path = "/api/v1/admin/users/" + driver.userId();
    assertThat(post(path + "/suspend", Map.of("note", "x"), support).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(post(path + "/suspend", Map.of("note", " "), admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    JsonNode trust =
        ok(post(path + "/suspend", Map.of("note", "Fraud investigation"), admin), HttpStatus.OK);
    assertThat(trust.get("accountState").asText()).isEqualTo("suspended");
    assertThat(trust.get("accountSuspensionNote").asText()).isEqualTo("Fraud investigation");
    assertThat(trust.get("accountSuspendedAt").isNull()).isFalse();
    // Role states are untouched: this is the account level.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    // Suspension forces the driver offline.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?",
                Boolean.class,
                driver.userId()))
        .isFalse();

    for (ResponseEntity<JsonNode> refused :
        List.of(
            get("/api/v1/driver/rides", driver.token()),
            put("/api/v1/driver/availability", Map.of("online", true), driver.token()),
            get("/api/v1/driver/availability", driver.token()),
            get("/api/v1/driver/performance", driver.token()),
            get("/api/v1/driver/earnings/summary?period=weekly", driver.token()),
            get("/api/v1/rides", driver.token()),
            tryBook(driver, booking(List.of())),
            get("/api/v1/wallet", driver.token()),
            get("/api/v1/rider/preferences", driver.token()),
            get("/api/v1/chat/quick-replies?as=driver", driver.token()),
            get("/api/v1/ratings/pending?as=driver", driver.token()),
            get("/api/v1/reports/mine?as=driver", driver.token()))) {
      assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(code(refused)).isEqualTo("account_suspended");
    }
    // Login and the profile still work, so the app can show the suspended screen with the note.
    assertThat(tryLogin(driver.phone(), PASSWORD, ClientType.DRIVER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    JsonNode profile = ok(get("/api/v1/users/me", driver.token()), HttpStatus.OK);
    assertThat(profile.get("state").asText()).isEqualTo("suspended");
    assertThat(profile.get("suspensionNote").asText()).isEqualTo("Fraud investigation");
    ok(get("/api/v1/notifications?app=driver", driver.token()), HttpStatus.OK);
    assertThat(outboxParams(driver.userId(), "account.suspended"))
        .singleElement()
        .satisfies(params -> assertThat(params).contains("Fraud investigation"));
    assertThat(auditActions(driver.userId().toString())).contains("user.suspend");
    ResponseEntity<JsonNode> twice = post(path + "/suspend", Map.of("note", "again"), admin);
    assertThat(twice.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(twice)).isEqualTo("already_suspended");

    JsonNode reactivated =
        ok(post(path + "/reactivate", Map.of("note", "Cleared"), admin), HttpStatus.OK);
    assertThat(reactivated.get("accountState").asText()).isEqualTo("active");
    assertThat(reactivated.get("accountSuspensionNote").isNull()).isTrue();
    ok(get("/api/v1/driver/rides", driver.token()), HttpStatus.OK);
    assertThat(
            ok(get("/api/v1/users/me", driver.token()), HttpStatus.OK)
                .get("suspensionNote")
                .isNull())
        .isTrue();
    assertThat(outboxParams(driver.userId(), "account.reactivated"))
        .singleElement()
        .satisfies(params -> assertThat(params).contains("Cleared"));
    assertThat(auditActions(driver.userId().toString())).contains("user.reactivate");
    ResponseEntity<JsonNode> notSuspended =
        post(path + "/reactivate", Map.of("note", "again"), admin);
    assertThat(notSuspended.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(notSuspended)).isEqualTo("not_suspended");
  }

  @Test
  @DisplayName(
      "USR-06 mid-ride (owner ruling 2026-10-15): a suspended account may SOS and finish its"
          + " in-flight ride incl. cash confirmation; everything new stays account_suspended")
  void shouldLetASuspendedAccountSosAndFinishItsRide() {
    Account rider = rider();
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    for (Account account : List.of(rider, driver)) {
      ok(
          post(
              "/api/v1/admin/users/" + account.userId() + "/suspend",
              Map.of("note", "Investigation"),
              admin),
          HttpStatus.OK);
    }
    Map<String, Object> sos =
        Map.of("lat", PICKUP_LAT, "lng", PICKUP_LNG, "recordedAt", CLOCK.instant().toString());

    // SOS and the in-flight ride's reads and chat stay available to both parties.
    ok(post("/api/v1/rides/" + rideId + "/sos", sos, rider.token()), HttpStatus.CREATED);
    ok(post("/api/v1/rides/" + rideId + "/sos", sos, driver.token()), HttpStatus.CREATED);
    ok(get("/api/v1/rides/" + rideId, rider.token()), HttpStatus.OK);
    ok(get("/api/v1/rides/active", rider.token()), HttpStatus.OK);
    ok(get("/api/v1/rides/" + rideId + "/cancellation-quote", rider.token()), HttpStatus.OK);
    ok(get("/api/v1/rides/" + rideId + "/chat", rider.token()), HttpStatus.OK);
    ok(get("/api/v1/driver/rides/active", driver.token()), HttpStatus.OK);
    ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK);
    ok(get("/api/v1/chat/quick-replies?as=driver", driver.token()), HttpStatus.OK);
    ok(get("/api/v1/driver/availability", driver.token()), HttpStatus.OK); // cold-start resume

    // Everything new is refused.
    for (ResponseEntity<JsonNode> refused :
        List.of(
            tryBook(rider, booking(List.of())),
            post("/api/v1/rides/estimate", booking(List.of()), rider.token()),
            get("/api/v1/wallet", rider.token()),
            get("/api/v1/ratings/pending?as=rider", rider.token()),
            put("/api/v1/driver/availability", Map.of("online", false), driver.token()),
            get("/api/v1/driver/offers/open", driver.token()),
            get("/api/v1/wallet", driver.token()))) {
      assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(code(refused)).isEqualTo("account_suspended");
    }

    // The driver finishes the ride: locations, arrive, start, complete, cash confirmation.
    position(driver, PICKUP_LAT, PICKUP_LNG);
    ok(driverAction(driver, rideId, "arrive"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "start"), HttpStatus.OK);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    ok(get("/api/v1/driver/rides/" + rideId, driver.token()), HttpStatus.OK);
    ok(driverAction(driver, rideId, "cash-confirm"), HttpStatus.OK);
    assertThat(stateOf(rideId)).isEqualTo("completed");
    // The ride ended: the driver went offline; the payment step is done, so it is closed too.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?",
                Boolean.class,
                driver.userId()))
        .isFalse();
    for (ResponseEntity<JsonNode> refused :
        List.of(
            driverAction(driver, rideId, "mark-unpaid"),
            get("/api/v1/driver/rides/" + rideId, driver.token()),
            get("/api/v1/driver/availability", driver.token()),
            post(
                "/api/v1/driver/locations",
                Map.of("samples", List.of(sample(PICKUP_LAT, PICKUP_LNG, CLOCK.instant()))),
                driver.token()),
            get("/api/v1/rides/" + rideId, rider.token()),
            get("/api/v1/rides/" + rideId + "/chat", rider.token()),
            rate(rider, rideId, 5),
            rate(driver, rideId, 5))) {
      assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(code(refused)).isEqualTo("account_suspended");
    }
    // SOS is never gated: on the ended ride the normal SOS rules answer, not the suspension.
    ResponseEntity<JsonNode> lateSos = post("/api/v1/rides/" + rideId + "/sos", sos, rider.token());
    assertThat(code(lateSos)).isEqualTo("ride_not_active");
  }

  @Test
  @DisplayName("USR-06: admin accounts, deleted accounts and unknown users are out of scope")
  void shouldRefuseAdminAndDeletedAccounts() {
    UUID adminUserId =
        jdbcTemplate.queryForObject(
            "SELECT user_id FROM users WHERE phone = '+963937900000'", UUID.class);
    ResponseEntity<JsonNode> adminAccount =
        post("/api/v1/admin/users/" + adminUserId + "/suspend", Map.of("note", "n"), admin);
    assertThat(adminAccount.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(adminAccount)).isEqualTo("admin_account");
    ResponseEntity<JsonNode> adminRole =
        post(
            "/api/v1/admin/users/" + adminUserId + "/roles/rider/suspend",
            Map.of("note", "n"),
            admin);
    assertThat(adminRole.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(adminRole)).isEqualTo("admin_account");

    Account rider = newRider();
    jdbcTemplate.update(
        "UPDATE users SET state = 'deleted', deleted_at = now() WHERE user_id = ?", rider.userId());
    ResponseEntity<JsonNode> deleted =
        post("/api/v1/admin/users/" + rider.userId() + "/suspend", Map.of("note", "n"), admin);
    assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(deleted)).isEqualTo("account_deleted");
    assertThat(
            post(
                    "/api/v1/admin/users/" + UUID.randomUUID() + "/suspend",
                    Map.of("note", "n"),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/admin/users/" + UUID.randomUUID() + "/trust", admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName(
      "USR-06 role level: a manual suspension carries its note, replaces an automatic reason,"
          + " never stacks, forces the driver offline; reactivation lifts it")
  void shouldSuspendAndReactivateRolesManually() {
    Account rider = newRider();
    String riderPath = "/api/v1/admin/users/" + rider.userId() + "/roles/rider";
    JsonNode trust =
        ok(post(riderPath + "/suspend", Map.of("note", "Abusive messages"), admin), HttpStatus.OK);
    JsonNode riderRole = TrustRatingsIntegrationTest.roleTrust(trust, "rider");
    assertThat(riderRole.get("state").asText()).isEqualTo("suspended");
    assertThat(riderRole.get("suspensionReason").asText()).isEqualTo("manual");
    assertThat(riderRole.get("suspensionNote").asText()).isEqualTo("Abusive messages");
    assertThat(riderRole.get("activeWarnings")).isEmpty();
    ResponseEntity<JsonNode> booking = tryBook(rider, booking(List.of()));
    assertThat(booking.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(code(booking)).isEqualTo("rider_suspended");
    JsonNode profileRole = ok(get("/api/v1/users/me", rider.token()), HttpStatus.OK).get("roles");
    assertThat(profileRole.toString()).contains("\"suspensionNote\":\"Abusive messages\"");
    assertThat(outboxParams(rider.userId(), "account.role_suspended"))
        .singleElement()
        .satisfies(
            params -> assertThat(params).contains("\"reason\": \"manual\"", "Abusive messages"));
    assertThat(auditActions(rider.userId().toString())).containsExactly("user.role_suspend");
    ResponseEntity<JsonNode> twice = post(riderPath + "/suspend", Map.of("note", "again"), admin);
    assertThat(twice.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(twice)).isEqualTo("already_suspended");
    ok(post(riderPath + "/reactivate", Map.of("note", "Apologised"), admin), HttpStatus.OK);
    assertThat(roleRow(rider.userId(), "rider").get("state")).isEqualTo("active");
    assertThat(roleRow(rider.userId(), "rider").get("suspension_note")).isNull();

    // A driver role suspended for low rating: the manual suspension replaces the reason.
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    String driverPath = "/api/v1/admin/users/" + driver.userId() + "/roles/driver";
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = 'low_rating',"
            + " suspended_at = now() WHERE user_id = ? AND role = 'driver'",
        driver.userId());
    ok(post(driverPath + "/suspend", Map.of("note", "Under review"), admin), HttpStatus.OK);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("manual");
    assertThat(roleRow(driver.userId(), "driver").get("suspension_note")).isEqualTo("Under review");
    // A manual role suspension forces an online driver offline.
    Account online = driverAt(PICKUP_LAT, PICKUP_LNG);
    ok(
        post(
            "/api/v1/admin/users/" + online.userId() + "/roles/driver/suspend",
            Map.of("note", "Paused"),
            admin),
        HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?",
                Boolean.class,
                online.userId()))
        .isFalse();

    // Path errors: a role the user does not hold, an unknown role.
    assertThat(
            post(
                    "/api/v1/admin/users/" + rider.userId() + "/roles/driver/suspend",
                    Map.of("note", "n"),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            post(
                    "/api/v1/admin/users/" + rider.userId() + "/roles/admin/suspend",
                    Map.of("note", "n"),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "Review B-W4: reactivating a driver whose current document expired keeps the role suspended"
          + " for document_expired, audited, with the DRV-04 notice instead of the reactivation")
  void shouldKeepAnExpiredDocumentDriverSuspendedOnReactivation() {
    Account driver = newDriver();
    String path = "/api/v1/admin/users/" + driver.userId() + "/roles/driver";
    ok(post(path + "/suspend", Map.of("note", "Complaints"), admin), HttpStatus.OK);
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = CURRENT_DATE - 2 WHERE driver_user_id = ?"
            + " AND type = 'drivers_license'",
        driver.userId());

    JsonNode trust =
        ok(post(path + "/reactivate", Map.of("note", "Resolved"), admin), HttpStatus.OK);
    JsonNode role = TrustRatingsIntegrationTest.roleTrust(trust, "driver");
    assertThat(role.get("state").asText()).isEqualTo("suspended");
    assertThat(role.get("suspensionReason").asText()).isEqualTo("document_expired");
    assertThat(role.get("suspensionNote").isNull()).isTrue();
    assertThat(outboxParams(driver.userId(), "driver.suspended"))
        .singleElement()
        .satisfies(params -> assertThat(params).contains("\"reason\": \"document_expired\""));
    assertThat(outboxParams(driver.userId(), "account.role_reactivated")).isEmpty();
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT after_state::text FROM audit_log WHERE target_id = ? AND action ="
                    + " 'user.role_reactivate'",
                String.class,
                driver.userId().toString()))
        .contains("\"result\": \"document_expired\"", "Resolved");
    // From here only an approved renewal lifts it.
    ResponseEntity<JsonNode> again = post(path + "/reactivate", Map.of("note", "n"), admin);
    assertThat(code(again)).isEqualTo("document_expired");
  }

  @Test
  @DisplayName(
      "Re-audit W-1: a low-rating reactivation that ends as document_expired, then the renewal"
          + " lifting it, both count as reactivations — no re-suspension without a newer rating")
  void shouldNotReSuspendAfterRenewalWithoutANewerRating() {
    Account rider = newRider();
    Account driver = newDriver();
    driverRatedTimes(rider, driver, 19, 1);
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 1);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = CURRENT_DATE - 2 WHERE driver_user_id = ?"
            + " AND type = 'drivers_license'",
        driver.userId());

    advance(Duration.ofMinutes(1));
    ok(
        post(
            "/api/v1/admin/users/" + driver.userId() + "/roles/driver/reactivate",
            Map.of("note", "Coached"),
            admin),
        HttpStatus.OK);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason"))
        .isEqualTo("document_expired");
    // The nightly pass leaves the document suspension alone (it suspends ACTIVE roles only).
    dailyJob();
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason"))
        .isEqualTo("document_expired");

    advance(Duration.ofMinutes(1));
    JsonNode renewal =
        ok(
            post(
                "/api/v1/driver/documents/drivers_license/renewal",
                Map.of(
                    "number",
                    "RENEWED",
                    "expiresOn",
                    today().plusYears(1).toString(),
                    "fileId",
                    upload(driver.token(), "document", PDF).toString()),
                driver.token()),
            HttpStatus.CREATED);
    ok(
        post(
            "/api/v1/admin/document-renewals/" + renewal.get("id").asText() + "/approve",
            null,
            admin),
        HttpStatus.OK);
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");

    // The average is still far below 3.0, but no rating was stored since the renewal lifted it.
    advance(Duration.ofDays(1));
    dailyJob();
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    // One newer low rating: the next pass suspends again.
    rateAndEvaluate(rider, completedRide(rider.userId(), driver.userId(), CLOCK.instant()), 1);
    assertThat(roleRow(driver.userId(), "driver").get("suspension_reason")).isEqualTo("low_rating");
  }

  @Test
  @DisplayName(
      "Review B-W5: a whole-account suspension system-cancels the rider's pre-acceptance request"
          + " (reason account_suspended, no fee) and withdraws its open offer")
  void shouldCancelPendingRequestsOnAccountSuspension() {
    Account driver = driverAt(PICKUP_LAT, PICKUP_LNG);
    Account rider = rider();
    UUID rideId = book(rider);
    dispatch();
    assertThat(stateOf(rideId)).isEqualTo("offering");
    assertThat(hasOpenOffer(driver)).isTrue();

    ok(
        post("/api/v1/admin/users/" + rider.userId() + "/suspend", Map.of("note", "Fraud"), admin),
        HttpStatus.OK);
    Map<String, Object> ride =
        jdbcTemplate.queryForMap(
            "SELECT state, cancellation_reason, cancellation_fee, cancelled_at FROM rides"
                + " WHERE ride_id = ?",
            rideId);
    assertThat(ride.get("state")).isEqualTo("cancelled_by_rider");
    assertThat(ride.get("cancellation_reason")).isEqualTo("account_suspended");
    assertThat(ride.get("cancellation_fee")).isNull();
    assertThat(ride.get("cancelled_at")).isNotNull();
    assertThat(offerResponses(rideId)).containsExactly("withdrawn");
    assertThat(hasOpenOffer(driver)).isFalse();
    dispatch(); // nothing left to dispatch
    assertThat(hasOpenOffer(driver)).isFalse();
    // The rider's history row says why (read after reactivation: history is a feature path).
    ok(
        post(
            "/api/v1/admin/users/" + rider.userId() + "/reactivate",
            Map.of("note", "Cleared"),
            admin),
        HttpStatus.OK);
    JsonNode row = ok(get("/api/v1/rides", rider.token()), HttpStatus.OK).get("items").get(0);
    assertThat(row.get("id").asText()).isEqualTo(rideId.toString());
    assertThat(row.get("cancellationReason").asText()).isEqualTo("account_suspended");
  }

  @Test
  @DisplayName("RBAC: the trust profile needs users:view, every suspend/reactivate users:suspend")
  void shouldGateTheTrustEndpoints() {
    Account rider = newRider();
    String support = supportAdmin("+963937650041");
    String powerless = powerlessAdmin("+963937650042");
    String path = "/api/v1/admin/users/" + rider.userId();
    ok(get(path + "/trust", support), HttpStatus.OK);
    ok(get("/api/v1/admin/flags", support), HttpStatus.OK);
    for (String token : List.of(powerless, rider.token())) {
      assertThat(get(path + "/trust", token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(get("/api/v1/admin/flags", token).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }
    for (String token : List.of(support, powerless, rider.token())) {
      for (String action :
          List.of("/suspend", "/reactivate", "/roles/rider/suspend", "/roles/rider/reactivate")) {
        assertThat(post(path + action, Map.of("note", "n"), token).getStatusCode())
            .as(action)
            .isEqualTo(HttpStatus.FORBIDDEN);
      }
    }
    assertThat(roleRow(rider.userId(), "rider").get("state")).isEqualTo("active");
    assertThat(auditActions(rider.userId().toString())).isEmpty();
  }
}
