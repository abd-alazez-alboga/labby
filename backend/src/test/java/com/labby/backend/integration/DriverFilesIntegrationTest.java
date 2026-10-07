package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.service.OrphanFileCleanupService;
import com.labby.backend.service.StorageProvider;
import com.labby.backend.util.RbacIds;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M5-T2 file security (NFR-S2): uploads are typed by their content, PDFs are documents only, a
 * fileId is usable by its uploader alone, files reach other people only through URLs minted after
 * the endpoint's own permission check (applicant → own; admin → driver-review:view), and raw
 * storage keys are never served.
 */
class DriverFilesIntegrationTest extends AbstractOnboardingIntegrationTest {

  @Autowired private OrphanFileCleanupService orphanFileCleanupService;
  @Autowired private StorageProvider storageProvider;

  private String storageKeyOf(UUID fileId) {
    return jdbcTemplate.queryForObject(
        "SELECT storage_key FROM stored_files WHERE stored_file_id = ?", String.class, fileId);
  }

  private void backdate(UUID fileId, int days) {
    jdbcTemplate.update(
        "UPDATE stored_files SET created_at = now() - make_interval(days => ?)"
            + " WHERE stored_file_id = ?",
        days,
        fileId);
  }

  private boolean rowExists(UUID fileId) {
    return Boolean.TRUE.equals(
        jdbcTemplate.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM stored_files WHERE stored_file_id = ?)",
            Boolean.class,
            fileId));
  }

  @Test
  @DisplayName("nightly cleanup deletes week-old unreferenced uploads (row + bytes) only")
  void shouldCleanUpOnlyOldOrphans() {
    Account applicant = registerApplicant("+963936000091", "Abandoner");
    UUID oldOrphan = upload(applicant.token(), "document", PDF);
    UUID freshOrphan = upload(applicant.token(), "document", PDF);
    UUID applicationId = submitApplication(applicant, "CL1");
    assertThat(applicationId).isNotNull();
    List<UUID> referenced =
        jdbcTemplate.queryForList(
            "SELECT stored_file_id FROM documents WHERE driver_user_id = ?",
            UUID.class,
            applicant.userId());
    String oldOrphanKey = storageKeyOf(oldOrphan);
    backdate(oldOrphan, 8);
    referenced.forEach(fileId -> backdate(fileId, 8));

    orphanFileCleanupService.runCleanup();

    assertThat(rowExists(oldOrphan)).isFalse();
    assertThatThrownBy(() -> storageProvider.load(oldOrphanKey))
        .isInstanceOf(ResourceNotFoundException.class);
    assertThat(rowExists(freshOrphan)).isTrue();
    assertThat(referenced).isNotEmpty().allMatch(this::rowExists);
  }

  @Test
  @DisplayName("type comes from the magic bytes; PDF only as a document; junk/empty/kind → 400")
  void shouldDetectTypeFromContent() {
    Account applicant = registerApplicant("+963936000001", "Uploader");

    JsonNode png = ok(uploadRaw(applicant.token(), "vehicle_photo", PNG), HttpStatus.CREATED);
    assertThat(png.get("contentType").asText()).isEqualTo("image/png");
    assertThat(png.get("kind").asText()).isEqualTo("vehicle_photo");
    assertThat(png.get("sizeBytes").asLong()).isEqualTo(PNG.length);
    JsonNode jpeg = ok(uploadRaw(applicant.token(), "document", JPEG), HttpStatus.CREATED);
    assertThat(jpeg.get("contentType").asText()).isEqualTo("image/jpeg");
    JsonNode pdf = ok(uploadRaw(applicant.token(), "document", PDF), HttpStatus.CREATED);
    assertThat(pdf.get("contentType").asText()).isEqualTo("application/pdf");

    assertThat(uploadRaw(applicant.token(), "vehicle_photo", PDF).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(applicant.token(), "document", "GIF89a....".getBytes()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(applicant.token(), "document", new byte[0]).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(applicant.token(), "selfie", PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(applicant.token(), null, PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(applicant.token(), "document", null).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadRaw(null, "document", PDF).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

    String storageKey =
        jdbcTemplate.queryForObject(
            "SELECT storage_key FROM stored_files WHERE stored_file_id = ?::uuid",
            String.class,
            pdf.get("fileId").asText());
    assertThat(storageKey).matches("driver-files/[0-9a-f-]{36}\\.pdf");
  }

  @Test
  @DisplayName("another applicant can neither reference nor see your fileId")
  void shouldKeepFileIdsPrivateToTheUploader() {
    Account owner = registerApplicant("+963936000011", "Owner");
    Account thief = registerApplicant("+963936000012", "Thief");
    UUID ownersDocument = upload(owner.token(), "document", PDF);
    UUID ownersPhoto = upload(owner.token(), "vehicle_photo", PNG);

    Map<String, Object> body = applicationBody(thief.token(), "TH1");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> documents = (List<Map<String, Object>>) body.get("documents");
    documents.get(0).put("fileId", ownersDocument.toString());
    @SuppressWarnings("unchecked")
    Map<String, Object> vehicle = (Map<String, Object>) body.get("vehicle");
    vehicle.put("photoFileIds", List.of(ownersPhoto.toString()));

    JsonNode error =
        ok(post("/api/v1/driver/application", body, thief.token()), HttpStatus.BAD_REQUEST);
    assertThat(error.get("fieldErrors").has("documents[government_id].fileId")).isTrue();
    assertThat(error.get("fieldErrors").has("vehicle.photoFileIds")).isTrue();

    // The owner's application is invisible to the other applicant (own data only).
    submitApplication(owner, "OWN1");
    assertThat(get("/api/v1/driver/application", thief.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/driver/vehicles", thief.token()).getBody()).isEmpty();
  }

  @Test
  @DisplayName("minted URLs serve the bytes; raw storage keys never do; admins need the permission")
  void shouldServeFilesOnlyThroughMintedUrls() {
    String reviewer = registerSuperAdmin("+963936000021");
    String support = registerAdmin("+963936000022", RbacIds.SUPPORT_ROLE_ID);
    Account applicant = registerApplicant("+963936000023", "Viewer Test");
    UUID applicationId = submitApplication(applicant, "URL1");

    // The applicant's own view carries working URLs for documents, vehicle photos and the photo.
    JsonNode own = ok(get("/api/v1/driver/application", applicant.token()), HttpStatus.OK);
    JsonNode documentFile = own.get("documents").get(0).get("file");
    assertThat(documentFile.get("urlExpiresAt").isNull()).isFalse();
    ResponseEntity<byte[]> pdf =
        restTemplate.getForEntity(documentFile.get("url").asText(), byte[].class);
    assertThat(pdf.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(pdf.getBody()).isEqualTo(PDF);
    assertThat(pdf.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE)).isEqualTo("application/pdf");
    String photoUrl = own.get("vehicle").get("photos").get(0).get("url").asText();
    assertThat(restTemplate.getForEntity(photoUrl, byte[].class).getBody()).isEqualTo(JPEG);
    String personalUrl = own.get("personal").get("photo").get("url").asText();
    assertThat(restTemplate.getForEntity(personalUrl, byte[].class).getBody()).isEqualTo(PNG);

    // Reviewers with driver-review:view get fresh URLs; everyone else is refused first.
    JsonNode adminView =
        ok(get("/api/v1/admin/driver-applications/" + applicationId, reviewer), HttpStatus.OK);
    String adminUrl = adminView.get("documents").get(0).get("file").get("url").asText();
    assertThat(restTemplate.getForEntity(adminUrl, byte[].class).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(get("/api/v1/admin/driver-applications/" + applicationId, support).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/driver-applications/" + applicationId, null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    // Raw keys and ids are not capabilities.
    String key =
        jdbcTemplate.queryForObject(
            "SELECT storage_key FROM stored_files WHERE stored_file_id = ?::uuid",
            String.class,
            documentFile.get("fileId").asText());
    assertThat(restTemplate.getForEntity("/api/v1/files/" + key, byte[].class).getStatusCode())
        .isIn(HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED);
    assertThat(
            restTemplate
                .getForEntity("/api/v1/files/" + documentFile.get("fileId").asText(), byte[].class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(restTemplate.getForEntity("/" + key, byte[].class).getStatusCode())
        .isIn(HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED);
  }
}
