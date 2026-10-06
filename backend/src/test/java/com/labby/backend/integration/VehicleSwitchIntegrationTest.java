package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * M5-T2 acceptance for UC-D-18 / UC-A-11: the current vehicle stays active until the switch is
 * approved, approval flips the single active vehicle (DRV-03), rejection keeps the old one, one
 * switch at a time (also under a race), only approved drivers switch, concurrent decisions → one
 * 409.
 */
class VehicleSwitchIntegrationTest extends AbstractOnboardingIntegrationTest {

  private static final String REVIEWS = "/api/v1/admin/vehicle-reviews";

  private String admin;
  private UUID economy;

  @BeforeEach
  void setUpReviewer() {
    admin = registerSuperAdmin("+963937000001");
    economy = serviceType("Economy", true, true);
  }

  private Map<String, Object> switchBody(Account driver, String plate) {
    return Map.of(
        "vehicle",
        newVehicle(driver.token(), plate),
        "documents",
        List.of(
            newDocument(driver.token(), "vehicle_registration", today().plusYears(1)),
            newDocument(driver.token(), "insurance", today().plusYears(1))));
  }

  private UUID submitSwitch(Account driver, String plate) {
    JsonNode pending =
        ok(
            post("/api/v1/driver/vehicles", switchBody(driver, plate), driver.token()),
            HttpStatus.CREATED);
    assertThat(pending.get("reviewStatus").asText()).isEqualTo("pending");
    assertThat(pending.get("active").asBoolean()).isFalse();
    assertThat(pending.get("documents")).hasSize(2);
    return UUID.fromString(pending.get("id").asText());
  }

  private UUID activeVehicle(UUID driverId) {
    return jdbcTemplate.queryForObject(
        "SELECT vehicle_id FROM vehicles WHERE driver_user_id = ? AND is_active",
        UUID.class,
        driverId);
  }

  @Test
  @DisplayName("UC-D-18: old vehicle active until approval; approval flips the active vehicle")
  void shouldSwitchVehicleOnApproval() {
    Account driver = approvedDriver("+963937000011", "OLD1", economy, admin);
    UUID oldVehicle = activeVehicle(driver.userId());

    UUID newVehicle = submitSwitch(driver, "NEW 1");
    assertThat(activeVehicle(driver.userId())).isEqualTo(oldVehicle);
    JsonNode own = ok(get("/api/v1/driver/vehicles", driver.token()), HttpStatus.OK);
    assertThat(own).hasSize(2);
    assertThat(own.get(0).get("id").asText()).isEqualTo(newVehicle.toString());

    JsonNode queue = ok(get(REVIEWS, admin), HttpStatus.OK);
    assertThat(queue).hasSize(1);
    assertThat(queue.get(0).get("plate").asText()).isEqualTo("NEW1");
    JsonNode detail = ok(get(REVIEWS + "/" + newVehicle, admin), HttpStatus.OK);
    assertThat(detail.get("currentVehicle").get("id").asText()).isEqualTo(oldVehicle.toString());
    assertThat(detail.get("vehicle").get("documents")).hasSize(2);
    assertThat(get(REVIEWS + "/" + oldVehicle, admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    JsonNode approved =
        ok(
            post(
                REVIEWS + "/" + newVehicle + "/approve",
                Map.of("serviceTypeIds", List.of(economy.toString())),
                admin),
            HttpStatus.OK);
    assertThat(approved.get("vehicle").get("active").asBoolean()).isTrue();
    assertThat(approved.get("vehicle").get("reviewStatus").asText()).isEqualTo("approved");
    assertThat(approved.get("vehicle").get("documents"))
        .allSatisfy(doc -> assertThat(doc.get("reviewStatus").asText()).isEqualTo("approved"));
    assertThat(activeVehicle(driver.userId())).isEqualTo(newVehicle);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM vehicles WHERE driver_user_id = ? AND is_active",
                Long.class,
                driver.userId()))
        .isEqualTo(1L);

    // The document slots now follow the new active vehicle.
    JsonNode slots = ok(get("/api/v1/driver/documents", driver.token()), HttpStatus.OK);
    assertThat(slots).hasSize(4);
    slots.forEach(
        slot -> {
          if (!slot.get("vehicleId").isNull()) {
            assertThat(slot.get("vehicleId").asText()).isEqualTo(newVehicle.toString());
          }
        });
    assertThat(outboxEvents(driver.userId()))
        .contains("vehicle_switch.submitted", "vehicle_switch.approved");
    assertThat(auditActions(newVehicle.toString())).containsExactly("vehicle.approve");
    // Decided → no second decision.
    assertThat(
            post(REVIEWS + "/" + newVehicle + "/reject", Map.of("reason", "late"), admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("UC-D-18 E1: a rejected switch keeps the current vehicle and shows the reason")
  void shouldKeepOldVehicleOnRejection() {
    Account driver = approvedDriver("+963937000021", "KEEP1", economy, admin);
    UUID oldVehicle = activeVehicle(driver.userId());
    UUID newVehicle = submitSwitch(driver, "NOPE1");

    JsonNode rejected =
        ok(
            post(REVIEWS + "/" + newVehicle + "/reject", Map.of("reason", "Photos unclear"), admin),
            HttpStatus.OK);
    assertThat(rejected.get("vehicle").get("reviewStatus").asText()).isEqualTo("rejected");
    assertThat(rejected.get("vehicle").get("reviewNote").asText()).isEqualTo("Photos unclear");
    assertThat(activeVehicle(driver.userId())).isEqualTo(oldVehicle);
    JsonNode own = ok(get("/api/v1/driver/vehicles", driver.token()), HttpStatus.OK);
    assertThat(own.get(0).get("reviewNote").asText()).isEqualTo("Photos unclear");
    assertThat(auditActions(newVehicle.toString())).containsExactly("vehicle.reject");
    assertThat(outboxEvents(driver.userId())).contains("vehicle_switch.rejected");

    // A new switch may follow a rejected one.
    submitSwitch(driver, "AGAIN1");
  }

  @Test
  @DisplayName("one switch at a time (sequential and simultaneous); applicants cannot switch")
  void shouldAllowOnlyOneSwitchAtATime() throws Exception {
    Account driver = approvedDriver("+963937000031", "ONE1", economy, admin);
    submitSwitch(driver, "TWO1");
    assertThat(
            post("/api/v1/driver/vehicles", switchBody(driver, "THREE1"), driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    Account racer = approvedDriver("+963937000032", "RACE0", economy, admin);
    Map<String, Object> first = switchBody(racer, "RACE1");
    Map<String, Object> second = switchBody(racer, "RACE2");
    List<HttpStatus> statuses =
        simultaneously(
            () -> post("/api/v1/driver/vehicles", first, racer.token()),
            () -> post("/api/v1/driver/vehicles", second, racer.token()));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.CREATED, HttpStatus.CONFLICT);

    Account applicant = registerApplicant("+963937000033", "Not Yet Driver");
    submitApplication(applicant, "APP1");
    assertThat(
            post("/api/v1/driver/vehicles", switchBody(applicant, "APP2"), applicant.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(get("/api/v1/driver/documents", applicant.token()).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("switch rules: duplicate plate and expired documents block approval; races → 409")
  void shouldGuardSwitchApproval() throws Exception {
    approvedDriver("+963937000041", "TAKEN1", economy, admin);
    Account driver = approvedDriver("+963937000042", "MINE1", economy, admin);
    UUID duplicate = submitSwitch(driver, "taken 1");
    assertThat(ok(get(REVIEWS, admin), HttpStatus.OK).get(0).get("duplicatePlate").asBoolean())
        .isTrue();
    assertThat(
            post(
                    REVIEWS + "/" + duplicate + "/approve",
                    Map.of("serviceTypeIds", List.of(economy.toString())),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    ok(
        post(REVIEWS + "/" + duplicate + "/reject", Map.of("reason", "Plate taken"), admin),
        HttpStatus.OK);

    UUID expiring = submitSwitch(driver, "MINE2");
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE vehicle_id = ? AND type = 'insurance'",
        today().minusDays(1),
        expiring);
    assertThat(
            post(
                    REVIEWS + "/" + expiring + "/approve",
                    Map.of("serviceTypeIds", List.of(economy.toString())),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE vehicle_id = ? AND type = 'insurance'",
        today().plusYears(1),
        expiring);

    String otherAdmin = registerSuperAdmin("+963937000043");
    List<HttpStatus> statuses =
        simultaneously(
            () ->
                post(
                    REVIEWS + "/" + expiring + "/approve",
                    Map.of("serviceTypeIds", List.of(economy.toString())),
                    admin),
            () -> post(REVIEWS + "/" + expiring + "/reject", Map.of("reason", "No"), otherAdmin));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    assertThat(
            post(
                    REVIEWS + "/" + UUID.randomUUID() + "/approve",
                    Map.of("serviceTypeIds", List.of(economy.toString())),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }
}
