package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.util.RbacIds;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * M5-T2 acceptance for the application state machine: UC-D-01 (submit; E1 per-item errors, E2
 * expired document, E3 duplicate plate flagged and blocking approval), UC-D-02 (resubmit exactly
 * the flagged items), UC-D-03 (status + history; approval grants the driver role; reapply after
 * rejection), the double-review race, permissions (RBAC-03) and the audit trail (RBAC-05).
 */
class DriverApplicationIntegrationTest extends AbstractOnboardingIntegrationTest {

  private static final String APPLICATIONS = "/api/v1/admin/driver-applications/";

  @Test
  @DisplayName("UC-D-01/03: submit → start review → approve; history, notifications, driver role")
  void shouldTakeApplicationToApproval() {
    String admin = registerSuperAdmin("+963935000001");
    UUID economy = serviceType("Economy", true, true);
    Account applicant = registerApplicant("+963935000002", "Rami Applicant");
    assertThat(get("/api/v1/driver/application", applicant.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    Map<String, Object> body = applicationBody(applicant.token(), " dm 12 345 ");
    JsonNode submitted =
        ok(post("/api/v1/driver/application", body, applicant.token()), HttpStatus.CREATED);
    UUID applicationId = UUID.fromString(submitted.get("id").asText());
    assertThat(submitted.get("status").asText()).isEqualTo("submitted");
    assertThat(submitted.get("vehicle").get("plate").asText()).isEqualTo("DM12345");
    assertThat(submitted.get("vehicle").get("active").asBoolean()).isFalse();
    assertThat(submitted.get("documents")).hasSize(4);
    assertThat(submitted.get("personal").get("name").asText()).isEqualTo("Rami Applicant");
    assertThat(submitted.get("personal").get("photo").get("url").asText())
        .startsWith("/api/v1/files/");
    assertThat(submitted.get("history")).hasSize(1);
    assertThat(submitted.get("history").get(0).get("fromStatus").isNull()).isTrue();

    // A second submission while one is open is a conflict.
    assertThat(
            post(
                    "/api/v1/driver/application",
                    applicationBody(applicant.token(), "X1"),
                    applicant.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    JsonNode queue = ok(get("/api/v1/admin/driver-applications", admin), HttpStatus.OK);
    assertThat(queue.get("totalItems").asInt()).isEqualTo(1);
    assertThat(queue.get("items").get(0).get("plate").asText()).isEqualTo("DM12345");
    assertThat(queue.get("items").get(0).get("applicant").get("phone").asText())
        .isEqualTo("+963935000002");

    // Decisions are only legal from under_review.
    assertThat(approve(applicationId, economy, admin).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
    startReview(applicationId, admin);
    assertThat(post(APPLICATIONS + applicationId + "/start-review", null, admin).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    JsonNode approved = ok(approve(applicationId, economy, admin), HttpStatus.OK);
    assertThat(approved.get("status").asText()).isEqualTo("approved");
    assertThat(approved.get("decidedAt").isNull()).isFalse();
    assertThat(approved.get("duplicatePlate").asBoolean()).isFalse();
    assertThat(approved.get("applicant").get("userId").asText())
        .isEqualTo(applicant.userId().toString());
    assertThat(approved.get("vehicle").get("active").asBoolean()).isTrue();
    assertThat(approved.get("vehicle").get("reviewStatus").asText()).isEqualTo("approved");
    assertThat(approved.get("vehicle").get("serviceTypes").get(0).get("id").asText())
        .isEqualTo(economy.toString());
    assertThat(approved.get("personal").get("reviewStatus").asText()).isEqualTo("approved");
    approved
        .get("documents")
        .forEach(
            document -> assertThat(document.get("reviewStatus").asText()).isEqualTo("approved"));

    JsonNode own = ok(get("/api/v1/driver/application", applicant.token()), HttpStatus.OK);
    List<String> stages = new ArrayList<>();
    own.get("history").forEach(event -> stages.add(event.get("toStatus").asText()));
    assertThat(stages).containsExactly("submitted", "under_review", "approved");

    // USR-01: approval grants the active driver role.
    JsonNode me = ok(get("/api/v1/users/me", applicant.token()), HttpStatus.OK);
    List<String> roles = new ArrayList<>();
    me.get("roles")
        .forEach(role -> roles.add(role.get("role").asText() + ":" + role.get("state").asText()));
    assertThat(roles).contains("driver:active");

    assertThat(outboxEvents(applicant.userId()))
        .containsExactly(
            "driver_application.submitted",
            "driver_application.under_review",
            "driver_application.approved");
    assertThat(auditActions(applicationId.toString()))
        .containsExactly("driver_application.start_review", "driver_application.approve");
  }

  @Test
  @DisplayName("UC-D-01 E1/E2: every problem is reported per item; expired documents are refused")
  void shouldReportPerItemErrors() {
    Account applicant = registerApplicant("+963935000011", "Per Item");
    Map<String, Object> body = applicationBody(applicant.token(), "AB123");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> documents = (List<Map<String, Object>>) body.get("documents");
    documents.get(3).put("expiresOn", today().toString()); // insurance expires today → E2
    documents.remove(1); // drivers_license missing
    @SuppressWarnings("unchecked")
    Map<String, Object> vehicle = (Map<String, Object>) body.get("vehicle");
    vehicle.put("photoFileIds", List.of());
    vehicle.put("year", today().getYear() + 2);

    JsonNode error =
        ok(post("/api/v1/driver/application", body, applicant.token()), HttpStatus.BAD_REQUEST);
    JsonNode fieldErrors = error.get("fieldErrors");
    assertThat(fieldErrors.has("documents[insurance].expiresOn")).isTrue();
    assertThat(fieldErrors.has("documents[drivers_license]")).isTrue();
    assertThat(fieldErrors.has("vehicle.photoFileIds")).isTrue();
    assertThat(fieldErrors.has("vehicle.year")).isTrue();
    assertThat(fieldErrors.has("profilePhoto")).isFalse();

    // Without a profile photo the personal item fails too.
    Account noPhoto = registerWithoutPhoto("+963935000012", "No Photo");
    JsonNode photoError =
        ok(
            post(
                "/api/v1/driver/application",
                applicationBody(noPhoto.token(), "AB124"),
                noPhoto.token()),
            HttpStatus.BAD_REQUEST);
    assertThat(photoError.get("fieldErrors").has("profilePhoto")).isTrue();

    // A vehicle photo used as a document file is the wrong kind.
    Map<String, Object> wrongKind = applicationBody(applicant.token(), "AB125");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> wrongDocs = (List<Map<String, Object>>) wrongKind.get("documents");
    wrongDocs.get(0).put("fileId", upload(applicant.token(), "vehicle_photo", PNG).toString());
    assertThat(
            ok(
                    post("/api/v1/driver/application", wrongKind, applicant.token()),
                    HttpStatus.BAD_REQUEST)
                .get("fieldErrors")
                .has("documents[government_id].fileId"))
        .isTrue();
    assertThat(jdbcTemplate.queryForObject("SELECT count(*) FROM driver_profiles", Long.class))
        .isZero();
  }

  @Test
  @DisplayName(
      "UC-D-01 E3: a plate on another driver's active vehicle is flagged and blocks approval")
  void shouldFlagDuplicatePlateAndBlockApproval() {
    String admin = registerSuperAdmin("+963935000021");
    UUID economy = serviceType("Economy", true, true);
    approvedDriver("+963935000022", "SY 777", economy, admin);

    Account second = registerApplicant("+963935000023", "Second Driver");
    UUID applicationId = submitApplication(second, "sy777");
    JsonNode detail = ok(get(APPLICATIONS + applicationId, admin), HttpStatus.OK);
    assertThat(detail.get("duplicatePlate").asBoolean()).isTrue();
    assertThat(
            ok(get("/api/v1/admin/driver-applications", admin), HttpStatus.OK)
                .get("items")
                .get(0)
                .get("duplicatePlate")
                .asBoolean())
        .isTrue();

    startReview(applicationId, admin);
    assertThat(approve(applicationId, economy, admin).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    // Resolved by requesting changes to the vehicle → corrected plate → approvable.
    ok(
        post(
            APPLICATIONS + applicationId + "/request-changes",
            Map.of(
                "items",
                List.of(Map.of("item", "vehicle", "note", "Plate belongs to someone else"))),
            admin),
        HttpStatus.OK);
    ok(
        post(
            "/api/v1/driver/application/resubmit",
            Map.of("vehicle", newVehicle(second.token(), "SY 778")),
            second.token()),
        HttpStatus.OK);
    assertThat(ok(approve(applicationId, economy, admin), HttpStatus.OK).get("status").asText())
        .isEqualTo("approved");
  }

  @Test
  @DisplayName("approval is refused while a document has expired during review")
  void shouldRefuseApprovalWithExpiredDocument() {
    String admin = registerSuperAdmin("+963935000031");
    UUID economy = serviceType("Economy", true, true);
    Account applicant = registerApplicant("+963935000032", "Slow Review");
    UUID applicationId = submitApplication(applicant, "EXP1");
    startReview(applicationId, admin);
    jdbcTemplate.update(
        "UPDATE documents SET expires_on = ? WHERE driver_user_id = ? AND type = 'insurance'",
        today().minusDays(1),
        applicant.userId());

    assertThat(approve(applicationId, economy, admin).getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("approval assigns only enabled service types of ACTIVE regions (400 otherwise)")
  void shouldValidateAssignedServiceTypes() {
    String admin = registerSuperAdmin("+963935000041");
    UUID economy = serviceType("Economy", true, true);
    UUID disabled = serviceType("Disabled", true, false);
    UUID draftRegion = serviceType("Draft", false, true);
    Account applicant = registerApplicant("+963935000042", "Service Types");
    UUID applicationId = submitApplication(applicant, "ST1");
    startReview(applicationId, admin);

    JsonNode assignable = ok(get("/api/v1/admin/assignable-service-types", admin), HttpStatus.OK);
    assertThat(assignable).hasSize(1);
    assertThat(assignable.get(0).get("id").asText()).isEqualTo(economy.toString());

    assertThat(approve(applicationId, disabled, admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(approve(applicationId, draftRegion, admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(approve(applicationId, UUID.randomUUID(), admin).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    APPLICATIONS + applicationId + "/approve",
                    Map.of("serviceTypeIds", List.of()),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName("UC-D-02: request per-item changes; resubmit exactly the flagged items")
  void shouldResubmitOnlyFlaggedItems() {
    String admin = registerSuperAdmin("+963935000051");
    UUID economy = serviceType("Economy", true, true);
    Account applicant = registerApplicant("+963935000052", "Needs Changes");
    UUID applicationId = submitApplication(applicant, "NC1");
    startReview(applicationId, admin);

    // Bad change requests: duplicates, document without a type, missing note.
    assertThat(
            post(
                    APPLICATIONS + applicationId + "/request-changes",
                    Map.of(
                        "items",
                        List.of(
                            Map.of("item", "vehicle", "note", "a"),
                            Map.of("item", "vehicle", "note", "b"))),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    APPLICATIONS + applicationId + "/request-changes",
                    Map.of("items", List.of(Map.of("item", "document", "note", "a"))),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    APPLICATIONS + applicationId + "/request-changes",
                    Map.of("items", List.of(Map.of("item", "personal"))),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    JsonNode flagged =
        ok(
            post(
                APPLICATIONS + applicationId + "/request-changes",
                Map.of(
                    "items",
                    List.of(
                        Map.of("item", "personal", "note", "Photo is blurry"),
                        Map.of(
                            "item",
                            "document",
                            "documentType",
                            "insurance",
                            "note",
                            "Expired scan")),
                    "note",
                    "Two fixes needed"),
                admin),
            HttpStatus.OK);
    assertThat(flagged.get("status").asText()).isEqualTo("needs_changes");
    assertThat(flagged.get("personal").get("reviewStatus").asText()).isEqualTo("changes_requested");
    assertThat(flagged.get("personal").get("reviewNote").asText()).isEqualTo("Photo is blurry");

    JsonNode own = ok(get("/api/v1/driver/application", applicant.token()), HttpStatus.OK);
    JsonNode insurance = documentOf(own, "insurance");
    assertThat(insurance.get("reviewStatus").asText()).isEqualTo("changes_requested");
    assertThat(insurance.get("reviewNote").asText()).isEqualTo("Expired scan");
    assertThat(own.get("history").get(2).get("note").asText()).isEqualTo("Two fixes needed");

    Map<String, Object> insuranceFix =
        newDocument(applicant.token(), "insurance", today().plusYears(2));
    // Missing a flagged item (personal not confirmed) → 400.
    assertThat(
            post(
                    "/api/v1/driver/application/resubmit",
                    Map.of("documents", List.of(insuranceFix)),
                    applicant.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    // An unflagged item included → 400 keyed by the item.
    Map<String, Object> extra = new HashMap<>();
    extra.put("confirmPersonalDetails", true);
    extra.put(
        "documents",
        List.of(
            insuranceFix, newDocument(applicant.token(), "government_id", today().plusYears(2))));
    JsonNode extraError =
        ok(
            post("/api/v1/driver/application/resubmit", extra, applicant.token()),
            HttpStatus.BAD_REQUEST);
    assertThat(extraError.get("fieldErrors").has("documents[government_id]")).isTrue();
    Map<String, Object> withVehicle = new HashMap<>();
    withVehicle.put("confirmPersonalDetails", true);
    withVehicle.put("documents", List.of(insuranceFix));
    withVehicle.put("vehicle", newVehicle(applicant.token(), "NC2"));
    assertThat(
            ok(
                    post("/api/v1/driver/application/resubmit", withVehicle, applicant.token()),
                    HttpStatus.BAD_REQUEST)
                .get("fieldErrors")
                .has("vehicle"))
        .isTrue();

    JsonNode resubmitted =
        ok(
            post(
                "/api/v1/driver/application/resubmit",
                Map.of("confirmPersonalDetails", true, "documents", List.of(insuranceFix)),
                applicant.token()),
            HttpStatus.OK);
    assertThat(resubmitted.get("status").asText()).isEqualTo("under_review");
    assertThat(resubmitted.get("personal").get("reviewStatus").asText()).isEqualTo("pending");
    JsonNode newInsurance = documentOf(resubmitted, "insurance");
    assertThat(newInsurance.get("reviewStatus").asText()).isEqualTo("pending");
    assertThat(newInsurance.get("expiresOn").asText()).isEqualTo(today().plusYears(2).toString());
    assertThat(newInsurance.get("id").asText()).isNotEqualTo(insurance.get("id").asText());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT review_status FROM documents WHERE document_id = ?::uuid",
                String.class,
                insurance.get("id").asText()))
        .isEqualTo("superseded");

    // Not needs_changes any more → resubmit is a conflict.
    assertThat(
            post(
                    "/api/v1/driver/application/resubmit",
                    Map.of("confirmPersonalDetails", true),
                    applicant.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.CONFLICT);

    assertThat(ok(approve(applicationId, economy, admin), HttpStatus.OK).get("documents"))
        .allSatisfy(
            document -> assertThat(document.get("reviewStatus").asText()).isEqualTo("approved"));
    assertThat(outboxEvents(applicant.userId()))
        .containsExactly(
            "driver_application.submitted",
            "driver_application.under_review",
            "driver_application.needs_changes",
            "driver_application.under_review",
            "driver_application.approved");
  }

  @Test
  @DisplayName("UC-D-03 A2: a rejected applicant reapplies in full on the same application")
  void shouldRejectAndAllowReapplication() {
    String admin = registerSuperAdmin("+963935000061");
    Account applicant = registerApplicant("+963935000062", "Try Again");
    UUID applicationId = submitApplication(applicant, "RJ1");
    startReview(applicationId, admin);
    assertThat(
            post(APPLICATIONS + applicationId + "/reject", Map.of("reason", " "), admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    JsonNode rejected =
        ok(
            post(
                APPLICATIONS + applicationId + "/reject",
                Map.of("reason", "Licence unreadable"),
                admin),
            HttpStatus.OK);
    assertThat(rejected.get("status").asText()).isEqualTo("rejected");
    assertThat(rejected.get("rejectionReason").asText()).isEqualTo("Licence unreadable");
    assertThat(rejected.get("vehicle").get("reviewStatus").asText()).isEqualTo("rejected");

    JsonNode reapplied =
        ok(
            post(
                "/api/v1/driver/application",
                applicationBody(applicant.token(), "RJ2"),
                applicant.token()),
            HttpStatus.CREATED);
    assertThat(reapplied.get("id").asText()).isEqualTo(applicationId.toString());
    assertThat(reapplied.get("status").asText()).isEqualTo("submitted");
    assertThat(reapplied.get("rejectionReason").isNull()).isTrue();
    assertThat(reapplied.get("vehicle").get("plate").asText()).isEqualTo("RJ2");
    reapplied
        .get("documents")
        .forEach(
            document -> assertThat(document.get("reviewStatus").asText()).isEqualTo("pending"));
    List<String> stages = new ArrayList<>();
    reapplied.get("history").forEach(event -> stages.add(event.get("toStatus").asText()));
    assertThat(stages).containsExactly("submitted", "under_review", "rejected", "submitted");
    assertThat(auditActions(applicationId.toString()))
        .containsExactly("driver_application.start_review", "driver_application.reject");
  }

  @Test
  @DisplayName("race: two simultaneous decisions on one application → exactly one 200, one 409")
  void shouldSerializeConcurrentDecisions() throws Exception {
    String admin = registerSuperAdmin("+963935000071");
    String otherAdmin = registerSuperAdmin("+963935000072");
    UUID economy = serviceType("Economy", true, true);
    for (int round = 0; round < 3; round++) {
      Account applicant = registerApplicant("+96393500008" + round, "Race " + round);
      UUID applicationId = submitApplication(applicant, "RACE" + round);
      startReview(applicationId, admin);

      List<HttpStatus> statuses =
          simultaneously(
              () -> approve(applicationId, economy, admin),
              () -> approve(applicationId, economy, otherAdmin));
      assertThat(statuses).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
      assertThat(
              jdbcTemplate.queryForObject(
                  "SELECT count(*) FROM driver_application_events WHERE driver_profile_id = ?"
                      + " AND to_status = 'approved'",
                  Long.class,
                  applicationId))
          .isEqualTo(1L);
    }

    Account applicant = registerApplicant("+963935000090", "Race Mixed");
    UUID applicationId = submitApplication(applicant, "RACE9");
    startReview(applicationId, admin);
    List<HttpStatus> mixed =
        simultaneously(
            () -> approve(applicationId, economy, admin),
            () ->
                post(APPLICATIONS + applicationId + "/reject", Map.of("reason", "No"), otherAdmin));
    assertThat(mixed).containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("RBAC-03: 401 anonymous, 403 without driver-review:view/decide")
  void shouldEnforcePermissions() {
    String support = registerAdmin("+963935000101", RbacIds.SUPPORT_ROLE_ID);
    UUID viewOnlyRole = viewOnlyRole();
    String viewer = registerAdmin("+963935000102", viewOnlyRole);
    Account applicant = registerApplicant("+963935000103", "Perm Applicant");
    UUID applicationId = submitApplication(applicant, "PERM1");

    assertThat(get("/api/v1/driver/application", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(get("/api/v1/admin/driver-applications", null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    for (String url :
        List.of(
            "/api/v1/admin/driver-applications",
            APPLICATIONS + applicationId,
            "/api/v1/admin/assignable-service-types",
            "/api/v1/admin/vehicle-reviews",
            "/api/v1/admin/document-renewals",
            "/api/v1/admin/document-expiries")) {
      assertThat(get(url, support).getStatusCode()).as(url).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(get(url, applicant.token()).getStatusCode())
          .as(url)
          .isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(get(url, viewer).getStatusCode()).as(url).isEqualTo(HttpStatus.OK);
    }
    // View-only reviewers can read but never decide.
    assertThat(post(APPLICATIONS + applicationId + "/start-review", null, viewer).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(APPLICATIONS + applicationId + "/reject", Map.of("reason", "x"), viewer)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(
                    APPLICATIONS + UUID.randomUUID() + "/start-review",
                    null,
                    registerSuperAdmin("+963935000104"))
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  private UUID viewOnlyRole() {
    UUID roleId =
        jdbcTemplate.queryForObject(
            "INSERT INTO roles (name) VALUES ('Reviewer viewer') RETURNING role_id", UUID.class);
    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_id)"
            + " SELECT ?, permission_id FROM permissions WHERE code = 'driver-review:view'",
        roleId);
    return roleId;
  }

  private static JsonNode documentOf(JsonNode application, String type) {
    for (JsonNode document : application.get("documents")) {
      if (document.get("type").asText().equals(type)) {
        return document;
      }
    }
    throw new AssertionError("no " + type + " document in " + application);
  }
}
