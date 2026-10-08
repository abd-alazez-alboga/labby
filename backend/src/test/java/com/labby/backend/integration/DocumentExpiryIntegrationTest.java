package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.DocumentExpiryService;
import com.labby.backend.service.DriverRoleService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.convention.TestBean;

/**
 * M5-T2 acceptance for DRV-04 / UC-D-19 / UC-A-12 on a CONTROLLED clock (the application {@code
 * Clock} bean is replaced): 30- and 7-day reminders go out exactly once, an expired current
 * document suspends the driver role with {@code document_expired} (visible on /users/me), an
 * approved renewal supersedes the old document and reinstates the driver, other suspensions are
 * never lifted, and concurrent renewal decisions → one 409.
 */
class DocumentExpiryIntegrationTest extends AbstractOnboardingIntegrationTest {

  private static final MutableClock CLOCK = new MutableClock();

  @TestBean private Clock clock;

  @Autowired private DocumentExpiryService documentExpiryService;
  @Autowired private DriverRoleService driverRoleService;

  private String admin;
  private UUID economy;

  static Clock clock() {
    return CLOCK;
  }

  @BeforeEach
  void resetClock() {
    CLOCK.set(Instant.now());
    admin = registerSuperAdmin("+963938000001");
    economy = serviceType("Economy", true, true);
  }

  @Override
  protected LocalDate today() {
    return LocalDate.ofInstant(CLOCK.instant(), OPERATING_ZONE);
  }

  private void advanceDays(long days) {
    CLOCK.set(CLOCK.instant().plus(Duration.ofDays(days)));
  }

  private void setInsuranceExpiry(UUID driverId, LocalDate expiresOn) {
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE driver_user_id = ? AND type = 'insurance'"
            + " AND review_status = 'approved'",
        expiresOn,
        driverId);
  }

  private List<Map<String, Object>> reminders(UUID driverId) {
    return jdbcTemplate.queryForList(
        "SELECT params->>'documentType' AS type, (params->>'daysLeft')::int AS days,"
            + " params->>'expiresOn' AS expires FROM notification_outbox"
            + " WHERE user_id = ? AND event = 'document.expiry_reminder' ORDER BY created_at",
        driverId);
  }

  private JsonNode driverRole(Account driver) {
    for (JsonNode role : ok(get("/api/v1/users/me", driver.token()), HttpStatus.OK).get("roles")) {
      if (role.get("role").asText().equals("driver")) {
        return role;
      }
    }
    throw new AssertionError("no driver role");
  }

  private JsonNode slot(Account driver, String type) {
    for (JsonNode slot : ok(get("/api/v1/driver/documents", driver.token()), HttpStatus.OK)) {
      if (slot.get("type").asText().equals(type)) {
        return slot;
      }
    }
    throw new AssertionError("no " + type + " slot");
  }

  private UUID submitRenewal(Account driver, String type) {
    JsonNode renewal =
        ok(
            post(
                "/api/v1/driver/documents/" + type + "/renewal",
                Map.of(
                    "number",
                    "RENEWED",
                    "expiresOn",
                    today().plusYears(1).toString(),
                    "fileId",
                    upload(driver.token(), "document", PDF).toString()),
                driver.token()),
            HttpStatus.CREATED);
    assertThat(renewal.get("reviewStatus").asText()).isEqualTo("pending");
    return UUID.fromString(renewal.get("id").asText());
  }

  @Test
  @DisplayName("expiry → 30/7 reminders once → suspend → renew → approve → reinstated")
  void shouldRunTheFullExpiryCycle() {
    Account driver = approvedDriver("+963938000011", "EXP1", economy, admin);
    LocalDate expiresOn = today().plusDays(30);
    setInsuranceExpiry(driver.userId(), expiresOn);

    documentExpiryService.runExpiryCheck();
    documentExpiryService.runExpiryCheck();
    assertThat(reminders(driver.userId()))
        .singleElement()
        .satisfies(
            reminder -> {
              assertThat(reminder.get("type")).isEqualTo("insurance");
              assertThat(reminder.get("days")).isEqualTo(30);
              assertThat(reminder.get("expires")).isEqualTo(expiresOn.toString());
            });

    advanceDays(22); // 8 days left: nothing new
    documentExpiryService.runExpiryCheck();
    assertThat(reminders(driver.userId())).hasSize(1);

    advanceDays(1); // 7 days left: the second reminder, once
    documentExpiryService.runExpiryCheck();
    documentExpiryService.runExpiryCheck();
    assertThat(reminders(driver.userId())).hasSize(2);
    assertThat(reminders(driver.userId()).get(1).get("days")).isEqualTo(7);
    JsonNode upcoming =
        ok(get("/api/v1/admin/document-expiries?horizonDays=7", admin), HttpStatus.OK)
            .get("upcoming");
    assertThat(upcoming).hasSize(1);
    assertThat(upcoming.get(0).get("daysLeft").asInt()).isEqualTo(7);
    assertThat(upcoming.get(0).get("reminder7SentAt").isNull()).isFalse();
    assertThat(upcoming.get(0).get("driver").get("userId").asText())
        .isEqualTo(driver.userId().toString());

    advanceDays(7); // expiry day itself: still valid through it
    documentExpiryService.runExpiryCheck();
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("active");

    advanceDays(1); // the day after: expired → suspended
    documentExpiryService.runExpiryCheck();
    documentExpiryService.runExpiryCheck();
    JsonNode role = driverRole(driver);
    assertThat(role.get("state").asText()).isEqualTo("suspended");
    assertThat(role.get("suspensionReason").asText()).isEqualTo("document_expired");
    assertThat(outboxEvents(driver.userId()).stream().filter("driver.suspended"::equals))
        .hasSize(1);
    assertThat(slot(driver, "insurance").get("expired").asBoolean()).isTrue();
    JsonNode expired =
        ok(get("/api/v1/admin/document-expiries", admin), HttpStatus.OK).get("expired");
    assertThat(expired).hasSize(1);
    assertThat(expired.get(0).get("daysLeft").asInt()).isEqualTo(-1);
    assertThat(expired.get(0).get("driverSuspended").asBoolean()).isTrue();

    // Renewal is allowed while suspended; one pending at a time.
    UUID renewal = submitRenewal(driver, "insurance");
    assertThat(
            post(
                    "/api/v1/driver/documents/insurance/renewal",
                    Map.of(
                        "number",
                        "AGAIN",
                        "expiresOn",
                        today().plusYears(1).toString(),
                        "fileId",
                        upload(driver.token(), "document", PDF).toString()),
                    driver.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(slot(driver, "insurance").get("renewal").get("id").asText())
        .isEqualTo(renewal.toString());
    JsonNode queue = ok(get("/api/v1/admin/document-renewals", admin), HttpStatus.OK);
    assertThat(queue).hasSize(1);
    assertThat(queue.get(0).get("driverSuspended").asBoolean()).isTrue();
    assertThat(queue.get(0).get("current").get("expiresOn").asText())
        .isEqualTo(expiresOn.toString());
    assertThat(
            ok(get("/api/v1/admin/document-expiries", admin), HttpStatus.OK)
                .get("expired")
                .get(0)
                .get("renewalPending")
                .asBoolean())
        .isTrue();

    JsonNode approved =
        ok(
            post("/api/v1/admin/document-renewals/" + renewal + "/approve", null, admin),
            HttpStatus.OK);
    assertThat(approved.get("renewal").get("reviewStatus").asText()).isEqualTo("approved");
    assertThat(approved.get("current").get("reviewStatus").asText()).isEqualTo("superseded");
    assertThat(approved.get("driverSuspended").asBoolean()).isFalse();
    role = driverRole(driver);
    assertThat(role.get("state").asText()).isEqualTo("active");
    assertThat(role.has("suspensionReason")).isFalse();
    assertThat(outboxEvents(driver.userId()))
        .contains("document_renewal.submitted", "document_renewal.approved", "driver.reinstated");
    assertThat(auditActions(renewal.toString())).containsExactly("document.approve");
    JsonNode insurance = slot(driver, "insurance");
    assertThat(insurance.get("current").get("id").asText()).isEqualTo(renewal.toString());
    assertThat(insurance.get("expired").asBoolean()).isFalse();
    assertThat(insurance.get("renewal").isNull()).isTrue();

    // The next pass leaves the reinstated driver alone.
    documentExpiryService.runExpiryCheck();
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("active");
  }

  @Test
  @DisplayName("M7 (M6 owner item a): an expiry suspension forces an online driver offline")
  void shouldForceSuspendedDriverOffline() {
    Account driver = approvedDriver("+963938000071", "EXP7", economy, admin);
    HttpHeaders headers = bearer(driver.token());
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/driver/availability",
                    HttpMethod.PUT,
                    new HttpEntity<>(Map.of("online", true), headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    setInsuranceExpiry(driver.userId(), today().minusDays(1));

    documentExpiryService.runExpiryCheck();

    assertThat(driverRole(driver).get("state").asText()).isEqualTo("suspended");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT is_online FROM driver_profiles WHERE user_id = ?",
                Boolean.class,
                driver.userId()))
        .isFalse();
  }

  @Test
  @DisplayName("a suspension for another reason is never overridden nor lifted")
  void shouldNeverLiftOtherSuspensions() {
    Account driver = approvedDriver("+963938000021", "OTH1", economy, admin);
    jdbcTemplate.update(
        "UPDATE role_assignments SET state = 'suspended', suspension_reason = NULL"
            + " WHERE user_id = ? AND role = 'driver'",
        driver.userId());
    setInsuranceExpiry(driver.userId(), today().plusDays(1));
    advanceDays(2);

    documentExpiryService.runExpiryCheck();
    assertThat(driverRole(driver).has("suspensionReason")).isFalse();
    assertThat(outboxEvents(driver.userId())).doesNotContain("driver.suspended");

    UUID renewal = submitRenewal(driver, "insurance");
    ok(post("/api/v1/admin/document-renewals/" + renewal + "/approve", null, admin), HttpStatus.OK);
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("suspended");
    assertThat(outboxEvents(driver.userId())).doesNotContain("driver.reinstated");
  }

  @Test
  @DisplayName(
      "stale candidate: suspension re-checks under the role lock and skips a renewed driver")
  void shouldNotSuspendOnAStaleRead() {
    Account driver = approvedDriver("+963938000041", "STL1", economy, admin);
    setInsuranceExpiry(driver.userId(), today().plusDays(1));
    advanceDays(2);
    UUID renewal = submitRenewal(driver, "insurance");
    // The admin approves the renewal before the job runs, so the job's earlier read is stale:
    // suspending now must re-check and refuse, leaving the driver active.
    jdbcTemplate.update(
        "UPDATE documents SET review_status = 'superseded' WHERE driver_user_id = ?"
            + " AND type = 'insurance' AND review_status = 'approved'",
        driver.userId());
    jdbcTemplate.update(
        "UPDATE documents SET review_status = 'approved' WHERE document_id = ?", renewal);

    assertThat(driverRoleService.suspendForExpiredDocument(driver.userId())).isFalse();
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("active");
    assertThat(outboxEvents(driver.userId())).doesNotContain("driver.suspended");
  }

  @Test
  @DisplayName("renewal: stays suspended while another current document is still expired")
  void shouldReinstateOnlyWhenNothingCurrentIsExpired() {
    Account driver = approvedDriver("+963938000031", "TWO1", economy, admin);
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE driver_user_id = ?"
            + " AND type IN ('insurance', 'drivers_license') AND review_status = 'approved'",
        today().plusDays(1),
        driver.userId());
    advanceDays(2);
    documentExpiryService.runExpiryCheck();
    assertThat(driverRole(driver).get("suspensionReason").asText()).isEqualTo("document_expired");

    UUID insurance = submitRenewal(driver, "insurance");
    ok(
        post("/api/v1/admin/document-renewals/" + insurance + "/approve", null, admin),
        HttpStatus.OK);
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("suspended");

    UUID licence = submitRenewal(driver, "drivers_license");
    JsonNode rejected =
        ok(
            post(
                "/api/v1/admin/document-renewals/" + licence + "/reject",
                Map.of("reason", "Blurry scan"),
                admin),
            HttpStatus.OK);
    assertThat(rejected.get("renewal").get("reviewNote").asText()).isEqualTo("Blurry scan");
    assertThat(slot(driver, "drivers_license").get("renewal").get("reviewStatus").asText())
        .isEqualTo("rejected");
    assertThat(auditActions(licence.toString())).containsExactly("document.reject");

    UUID secondTry = submitRenewal(driver, "drivers_license");
    ok(
        post("/api/v1/admin/document-renewals/" + secondTry + "/approve", null, admin),
        HttpStatus.OK);
    assertThat(driverRole(driver).get("state").asText()).isEqualTo("active");
  }

  @Test
  @DisplayName("race: two simultaneous renewal decisions → one 200, one 409; expired renewal → 409")
  void shouldSerializeRenewalDecisions() throws Exception {
    String otherAdmin = registerSuperAdmin("+963938000041");
    Account driver = approvedDriver("+963938000042", "RR1", economy, admin);
    UUID renewal = submitRenewal(driver, "government_id");

    List<HttpStatus> statuses =
        simultaneously(
            () -> post("/api/v1/admin/document-renewals/" + renewal + "/approve", null, admin),
            () ->
                post("/api/v1/admin/document-renewals/" + renewal + "/approve", null, otherAdmin));
    assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM documents WHERE driver_user_id = ?"
                    + " AND type = 'government_id' AND review_status = 'approved'",
                Long.class,
                driver.userId()))
        .isEqualTo(1L);

    UUID late = submitRenewal(driver, "insurance");
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE document_id = ?", today().plusDays(1), late);
    advanceDays(2);
    assertThat(
            post("/api/v1/admin/document-renewals/" + late + "/approve", null, admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    assertThat(get("/api/v1/admin/document-renewals/" + UUID.randomUUID(), admin).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/admin/document-expiries?horizonDays=31", admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  /** A clock tests move by hand. */
  static final class MutableClock extends Clock {

    private final AtomicReference<Instant> now = new AtomicReference<>(Instant.now());

    void set(Instant instant) {
      now.set(instant);
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return Clock.fixed(now.get(), zone);
    }

    @Override
    public Instant instant() {
      return now.get();
    }
  }
}
