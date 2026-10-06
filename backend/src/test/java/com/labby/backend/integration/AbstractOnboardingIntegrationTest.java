package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.util.RbacIds;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/**
 * Shared fixtures for the M5-T2 onboarding integration tests: applicants with a profile photo,
 * admins by RBAC role, private uploads, contract-shaped request bodies, an active region with
 * service types, the full apply → review → approve path, and a simultaneous-request helper for the
 * race tests. Cleans every onboarding row before the parent removes the accounts (FK order).
 */
abstract class AbstractOnboardingIntegrationTest extends AbstractAuthIntegrationTest {

  protected static final String PASSWORD = "Secret123!";
  protected static final ZoneId OPERATING_ZONE = ZoneId.of("Asia/Damascus");
  protected static final byte[] PNG = {
    (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 'I', 'H', 'D', 'R'
  };
  protected static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16};
  protected static final byte[] PDF =
      "%PDF-1.7\n%test document\n".getBytes(StandardCharsets.US_ASCII);
  protected static final List<String> DOCUMENT_TYPES =
      List.of("government_id", "drivers_license", "vehicle_registration", "insurance");

  /** An applicant / driver account. */
  protected record Account(UUID userId, String token, String phone) {}

  @AfterEach
  void cleanOnboardingRows() {
    jdbcTemplate.update("DELETE FROM notification_outbox");
    jdbcTemplate.update("DELETE FROM documents");
    jdbcTemplate.update("DELETE FROM vehicle_photos");
    jdbcTemplate.update("DELETE FROM vehicle_service_types");
    jdbcTemplate.update("DELETE FROM vehicles");
    jdbcTemplate.update("DELETE FROM stored_files");
    jdbcTemplate.update("DELETE FROM driver_application_events");
    jdbcTemplate.update("DELETE FROM driver_profiles");
    jdbcTemplate.update("DELETE FROM service_types");
    jdbcTemplate.update("DELETE FROM regions");
    // Custom (non-system) RBAC roles some tests create, with their holders.
    jdbcTemplate.update(
        "DELETE FROM role_assignments WHERE admin_role_id IN"
            + " (SELECT role_id FROM roles WHERE NOT is_system)");
    jdbcTemplate.update(
        "DELETE FROM role_permissions WHERE role_id IN"
            + " (SELECT role_id FROM roles WHERE NOT is_system)");
    jdbcTemplate.update("DELETE FROM roles WHERE NOT is_system");
  }

  /** "Today" in the operating timezone on the real clock. */
  protected LocalDate today() {
    return LocalDate.now(OPERATING_ZONE);
  }

  /** Registers an account and gives it a profile photo (required to apply). */
  protected Account registerApplicant(String phone, String name) {
    Account account = registerWithoutPhoto(phone, name);
    HttpHeaders partHeaders = new HttpHeaders();
    partHeaders.setContentType(MediaType.IMAGE_PNG);
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    body.add("file", new HttpEntity<>(resource(PNG, "me.png"), partHeaders));
    HttpHeaders headers = bearer(account.token());
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/users/me/photo",
                    HttpMethod.PUT,
                    new HttpEntity<>(body, headers),
                    JsonNode.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    return account;
  }

  protected Account registerWithoutPhoto(String phone, String name) {
    AuthTokensResponseDto session = register(phone, PASSWORD, name);
    return new Account(session.user().id(), session.accessToken(), phone);
  }

  /** Registers an admin holding the given RBAC role and returns an admin-client access token. */
  protected String registerAdmin(String phone, UUID rbacRoleId) {
    AuthTokensResponseDto session = register(phone, PASSWORD, "Admin " + phone);
    jdbcTemplate.update(
        "INSERT INTO role_assignments (user_id, role, state, admin_role_id)"
            + " VALUES (?, 'admin', 'active', ?)",
        session.user().id(),
        rbacRoleId);
    return login(phone, PASSWORD, ClientType.ADMIN).accessToken();
  }

  protected String registerSuperAdmin(String phone) {
    return registerAdmin(phone, RbacIds.SUPER_ADMIN_ROLE_ID);
  }

  protected ResponseEntity<JsonNode> uploadRaw(String token, String kind, byte[] content) {
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    if (content != null) {
      HttpHeaders partHeaders = new HttpHeaders();
      // The declared type is deliberately misleading: detection must use the content.
      partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
      body.add("file", new HttpEntity<>(resource(content, "upload.bin"), partHeaders));
    }
    if (kind != null) {
      body.add("kind", kind);
    }
    HttpHeaders headers = token == null ? new HttpHeaders() : bearer(token);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    return restTemplate.exchange(
        "/api/v1/driver/files", HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
  }

  protected UUID upload(String token, String kind, byte[] content) {
    ResponseEntity<JsonNode> response = uploadRaw(token, kind, content);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return UUID.fromString(response.getBody().get("fileId").asText());
  }

  protected static Map<String, Object> document(String type, LocalDate expiresOn, UUID fileId) {
    Map<String, Object> document = new HashMap<>();
    document.put("type", type);
    document.put("number", "N-" + type);
    document.put("expiresOn", expiresOn.toString());
    document.put("fileId", fileId.toString());
    return document;
  }

  protected static Map<String, Object> vehicle(String plate, List<UUID> photoFileIds) {
    Map<String, Object> vehicle = new HashMap<>();
    vehicle.put("make", "Kia");
    vehicle.put("model", "Rio");
    vehicle.put("year", 2020);
    vehicle.put("color", "White");
    vehicle.put("plate", plate);
    vehicle.put("seats", 4);
    vehicle.put("photoFileIds", photoFileIds.stream().map(UUID::toString).toList());
    return vehicle;
  }

  protected Map<String, Object> newDocument(String token, String type, LocalDate expiresOn) {
    return document(type, expiresOn, upload(token, "document", PDF));
  }

  protected Map<String, Object> newVehicle(String token, String plate) {
    return vehicle(plate, List.of(upload(token, "vehicle_photo", JPEG)));
  }

  /** A complete, valid application body with fresh uploads; every document valid for a year. */
  protected Map<String, Object> applicationBody(String token, String plate) {
    List<Map<String, Object>> documents = new ArrayList<>();
    for (String type : DOCUMENT_TYPES) {
      documents.add(newDocument(token, type, today().plusYears(1)));
    }
    Map<String, Object> body = new HashMap<>();
    body.put("documents", documents);
    body.put("vehicle", newVehicle(token, plate));
    return body;
  }

  protected ResponseEntity<JsonNode> get(String url, String token) {
    HttpHeaders headers = token == null ? new HttpHeaders() : bearer(token);
    return restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), JsonNode.class);
  }

  protected ResponseEntity<JsonNode> post(String url, Object body, String token) {
    HttpHeaders headers = token == null ? new HttpHeaders() : bearer(token);
    headers.setContentType(MediaType.APPLICATION_JSON);
    return restTemplate.exchange(
        url, HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
  }

  protected JsonNode ok(ResponseEntity<JsonNode> response, HttpStatus expected) {
    assertThat(response.getStatusCode()).as("%s", response.getBody()).isEqualTo(expected);
    return response.getBody();
  }

  /** Inserts a region (active or draft) with one service type; returns the service type id. */
  protected UUID serviceType(String name, boolean activeRegion, boolean enabled) {
    UUID regionId =
        jdbcTemplate.queryForObject(
            "INSERT INTO regions (name, state) VALUES (?, ?) RETURNING region_id",
            UUID.class,
            "Region " + name + " " + UUID.randomUUID(),
            activeRegion ? "active" : "draft");
    return jdbcTemplate.queryForObject(
        "INSERT INTO service_types (region_id, name_en, name_ar, base_fare, per_km_rate,"
            + " per_min_rate, minimum_fare, enabled) VALUES (?, ?, 'نوع', 1, 1, 1, 1, ?)"
            + " RETURNING service_type_id",
        UUID.class,
        regionId,
        name,
        enabled);
  }

  /** Submits a full application and returns its id. */
  protected UUID submitApplication(Account applicant, String plate) {
    JsonNode application =
        ok(
            post(
                "/api/v1/driver/application",
                applicationBody(applicant.token(), plate),
                applicant.token()),
            HttpStatus.CREATED);
    return UUID.fromString(application.get("id").asText());
  }

  protected JsonNode startReview(UUID applicationId, String adminToken) {
    return ok(
        post(
            "/api/v1/admin/driver-applications/" + applicationId + "/start-review",
            null,
            adminToken),
        HttpStatus.OK);
  }

  protected ResponseEntity<JsonNode> approve(
      UUID applicationId, UUID serviceTypeId, String adminToken) {
    return post(
        "/api/v1/admin/driver-applications/" + applicationId + "/approve",
        Map.of("serviceTypeIds", List.of(serviceTypeId.toString())),
        adminToken);
  }

  /** Full path: register with photo → apply → start review → approve. */
  protected Account approvedDriver(
      String phone, String plate, UUID serviceTypeId, String adminToken) {
    Account driver = registerApplicant(phone, "Driver " + phone);
    UUID applicationId = submitApplication(driver, plate);
    startReview(applicationId, adminToken);
    ok(approve(applicationId, serviceTypeId, adminToken), HttpStatus.OK);
    return driver;
  }

  protected List<String> outboxEvents(UUID userId) {
    return jdbcTemplate.queryForList(
        "SELECT event FROM notification_outbox WHERE user_id = ? ORDER BY created_at",
        String.class,
        userId);
  }

  protected List<String> auditActions(String targetId) {
    return jdbcTemplate.queryForList(
        "SELECT action FROM audit_log WHERE target_id = ? ORDER BY created_at",
        String.class,
        targetId);
  }

  /** Fires the calls at the same instant and returns their HTTP status codes. */
  @SafeVarargs
  protected final List<HttpStatus> simultaneously(Callable<ResponseEntity<JsonNode>>... calls)
      throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(calls.length);
    try {
      CountDownLatch start = new CountDownLatch(1);
      List<Future<ResponseEntity<JsonNode>>> futures = new ArrayList<>();
      for (Callable<ResponseEntity<JsonNode>> call : calls) {
        futures.add(
            executor.submit(
                () -> {
                  start.await();
                  return call.call();
                }));
      }
      start.countDown();
      List<HttpStatus> statuses = new ArrayList<>();
      for (Future<ResponseEntity<JsonNode>> future : futures) {
        statuses.add(HttpStatus.valueOf(future.get().getStatusCode().value()));
      }
      return statuses;
    } finally {
      executor.shutdownNow();
    }
  }

  private static ByteArrayResource resource(byte[] content, String filename) {
    return new ByteArrayResource(content) {
      @Override
      public String getFilename() {
        return filename;
      }
    };
  }
}
