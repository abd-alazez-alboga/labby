package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.service.OrphanFileCleanupService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
 * M11-T2 reports (REP-01..03) through the API: photo uploads under the private-upload rules (kept
 * by the orphan cleanup once referenced), submission from acceptance on with per-direction
 * categories and at most 3 own photos, once per ride per reporter; the reports queue with evidence
 * and history; resolution exactly once with internal notes, the reporter told the OUTCOME only; the
 * REP-03 3-in-90-days sliding window (clock-controlled) opening a flag, never a suspension.
 */
class TrustReportsIntegrationTest extends AbstractTrustIntegrationTest {

  @Autowired private OrphanFileCleanupService orphanFileCleanupService;

  @Test
  @DisplayName("REP-01: report photos are private JPEG/PNG uploads, kind report_photo")
  void shouldUploadReportPhotos() {
    Account rider = newRider();
    ResponseEntity<JsonNode> png = uploadPhoto(rider.token(), PNG);
    assertThat(png.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(png.getBody().get("contentType").asText()).isEqualTo("image/png");
    assertThat(png.getBody().get("sizeBytes").asLong()).isEqualTo(PNG.length);
    assertThat(png.getBody().has("kind")).isFalse();
    UUID fileId = UUID.fromString(png.getBody().get("fileId").asText());
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT kind FROM stored_files WHERE stored_file_id = ?", String.class, fileId))
        .isEqualTo("report_photo");
    assertThat(uploadPhoto(rider.token(), JPEG).getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(uploadPhoto(rider.token(), PDF).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(uploadPhoto(rider.token(), null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    // The driver-files endpoint never mints report photos.
    assertThat(uploadRaw(rider.token(), "report_photo", PNG).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  @DisplayName(
      "REP-01: a party reports the counterpart from acceptance on, once per ride, with the"
          + " categories of its direction and up to 3 of its own unused photos")
  void shouldFileReportsPerDirection() {
    Account rider = newRider();
    Account driver = newDriver();
    Account stranger = newRider();
    UUID ride = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    UUID photo = photo(rider);

    ResponseEntity<JsonNode> wrongDirection =
        post(reportUrl(ride), report("unsafe_behavior", List.of()), rider.token());
    assertThat(wrongDirection.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(code(wrongDirection)).isEqualTo("invalid_category");
    assertThat(
            post(reportUrl(ride), report("unsafe_driving", List.of(photo(stranger))), rider.token())
                .getStatusCode())
        .as("a photo uploaded by someone else")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(
                    reportUrl(ride),
                    report(
                        "unsafe_driving",
                        List.of(photo(rider), photo(rider), photo(rider), photo(rider))),
                    rider.token())
                .getStatusCode())
        .as("more than 3 photos")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(reportUrl(ride), report("unsafe_driving", List.of(photo, photo)), rider.token())
                .getStatusCode())
        .as("the same photo twice")
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post(reportUrl(ride), report("unsafe_driving", List.of()), stranger.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(reportUrl(UUID.randomUUID()), report("other", List.of()), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(post(reportUrl(ride), Map.of("category", "made_up"), rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    Map<String, Object> body = report("unsafe_driving", List.of(photo));
    body.put("description", "Ran a red light");
    JsonNode filed = ok(post(reportUrl(ride), body, rider.token()), HttpStatus.CREATED);
    assertThat(filed.get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(filed.get("category").asText()).isEqualTo("unsafe_driving");
    assertThat(filed.get("status").asText()).isEqualTo("open");
    assertThat(filed.get("resolvedAt").isNull()).isTrue();
    ResponseEntity<JsonNode> twice =
        post(reportUrl(ride), report("other", List.of()), rider.token());
    assertThat(twice.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(twice)).isEqualTo("report_already_submitted");
    // A photo belongs to one report only.
    UUID other = completedRide(rider.userId(), driver.userId(), CLOCK.instant());
    assertThat(
            post(reportUrl(other), report("other", List.of(photo)), rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    // The mirrored direction: the driver reports the rider of the same ride.
    ok(
        post(reportUrl(ride), report("vehicle_damage", List.of()), driver.token()),
        HttpStatus.CREATED);
    // Cancelled after acceptance still has a counterpart; a ride never accepted has none.
    UUID cancelled =
        ride(
            rider.userId(),
            driver.userId(),
            "cancelled_by_rider",
            CLOCK.instant(),
            null,
            null,
            CLOCK.instant());
    ok(post(reportUrl(cancelled), report("other", List.of()), rider.token()), HttpStatus.CREATED);
    UUID unaccepted = ride(rider.userId(), null, "no_driver_found", null, null, null, null);
    ResponseEntity<JsonNode> noCounterpart =
        post(reportUrl(unaccepted), report("other", List.of()), rider.token());
    assertThat(noCounterpart.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(noCounterpart)).isEqualTo("no_counterpart");

    JsonNode mine = ok(get("/api/v1/reports/mine?as=rider", rider.token()), HttpStatus.OK);
    assertThat(mine.get("totalElements").asInt()).isEqualTo(2);
    assertThat(mine.get("items").get(0).has("resolutionNote")).isFalse();
    assertThat(
            ok(get("/api/v1/reports/mine?as=driver", driver.token()), HttpStatus.OK)
                .get("totalElements")
                .asInt())
        .isEqualTo(1);
    // Nothing tells the reported user: no notification on filing.
    assertThat(outboxEvents(driver.userId())).noneMatch(event -> event.startsWith("report."));
  }

  @Test
  @DisplayName(
      "REP-02: the queue shows evidence refs and history; a report resolves exactly once with"
          + " notes, audited; the reporter is told the outcome only")
  void shouldResolveReportsOnceAndNotifyTheOutcomeOnly() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID ride =
        ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
    UUID photo = photo(rider);
    String reportId =
        ok(
                post(
                    reportUrl(ride),
                    report("inappropriate_behavior", List.of(photo)),
                    rider.token()),
                HttpStatus.CREATED)
            .get("id")
            .asText();
    String support = supportAdmin("+963937650011");

    JsonNode queue = ok(get("/api/v1/admin/reports", support), HttpStatus.OK);
    assertThat(queue.get("totalElements").asInt()).isEqualTo(1);
    JsonNode row = queue.get("items").get(0);
    assertThat(row.get("reporter").get("userId").asText()).isEqualTo(rider.userId().toString());
    assertThat(row.get("reporter").get("role").asText()).isEqualTo("rider");
    assertThat(row.get("reported").get("role").asText()).isEqualTo("driver");
    assertThat(row.get("photoCount").asInt()).isEqualTo(1);
    assertThat(
            ok(
                    get("/api/v1/admin/reports?reportedUserId=" + rider.userId(), support),
                    HttpStatus.OK)
                .get("totalElements")
                .asInt())
        .isZero();
    JsonNode detail = ok(get("/api/v1/admin/reports/" + reportId, support), HttpStatus.OK);
    assertThat(detail.get("rideId").asText()).isEqualTo(ride.toString());
    assertThat(detail.get("photoUrls")).hasSize(1);
    assertThat(detail.get("photoUrls").get(0).asText()).startsWith("/api/v1/files/");
    assertThat(detail.get("reportedHistory").get("reportsAgainst").asInt()).isZero();
    assertThat(detail.get("reporterHistory").get("reportsFiled").asInt()).isZero();

    assertThat(
            post(
                    "/api/v1/admin/reports/" + reportId + "/resolve",
                    Map.of("outcome", "substantiated"),
                    support)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    JsonNode resolved =
        ok(
            post(
                "/api/v1/admin/reports/" + reportId + "/resolve",
                Map.of("outcome", "substantiated", "note", "Chat log confirms it"),
                support),
            HttpStatus.OK);
    assertThat(resolved.get("status").asText()).isEqualTo("substantiated");
    assertThat(resolved.get("resolutionNote").asText()).isEqualTo("Chat log confirms it");
    assertThat(resolved.get("resolvedBy").get("name").asText()).startsWith("Admin");
    ResponseEntity<JsonNode> again =
        post(
            "/api/v1/admin/reports/" + reportId + "/resolve",
            Map.of("outcome", "unsubstantiated", "note", "changed my mind"),
            support);
    assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(again)).isEqualTo("already_resolved");
    assertThat(auditActions(reportId)).containsExactly("report.resolve");

    assertThat(outboxParams(rider.userId(), "report.resolved"))
        .singleElement()
        .satisfies(
            params ->
                assertThat(params)
                    .contains("\"outcome\": \"substantiated\"", "\"role\": \"rider\"")
                    .doesNotContain("Chat log"));
    assertThat(outboxEvents(driver.userId())).noneMatch(event -> event.startsWith("report."));
    JsonNode mine = ok(get("/api/v1/reports/mine?as=rider", rider.token()), HttpStatus.OK);
    assertThat(mine.get("items").get(0).get("status").asText()).isEqualTo("substantiated");
    assertThat(mine.toString()).doesNotContain("Chat log");
    assertThat(
            ok(get("/api/v1/admin/reports?status=substantiated", support), HttpStatus.OK)
                .get("totalElements")
                .asInt())
        .isEqualTo(1);
    // The resolved report stays permanent; its photo survives the orphan cleanup.
    jdbcTemplate.update(
        "UPDATE stored_files SET created_at = created_at - interval '8 days'"
            + " WHERE owner_user_id = ?",
        rider.userId());
    UUID orphan = photo(rider);
    jdbcTemplate.update(
        "UPDATE stored_files SET created_at = created_at - interval '8 days'"
            + " WHERE stored_file_id = ?",
        orphan);
    orphanFileCleanupService.runCleanup();
    assertThat(fileExists(photo)).isTrue();
    assertThat(fileExists(orphan)).isFalse();
  }

  @Test
  @DisplayName(
      "REP-03: 3 substantiated reports whose resolution falls within 90 days open a"
          + " report_threshold flag — sliding window, flag only, never a suspension")
  void shouldFlagThreeSubstantiatedReportsInNinetyDays() {
    Account driver = newDriver();
    List<String> reports = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      Account rider = newRider();
      UUID ride =
          ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
      reports.add(
          ok(
                  post(reportUrl(ride), report("unsafe_driving", List.of()), rider.token()),
                  HttpStatus.CREATED)
              .get("id")
              .asText());
    }
    // A substantiated report against the driver's RIDER role never counts for the driver role.
    Account otherDriver = newDriver();
    UUID mirrored =
        ride(driver.userId(), otherDriver.userId(), "accepted", CLOCK.instant(), null, null, null);
    String againstRiderRole =
        ok(
                post(reportUrl(mirrored), report("other", List.of()), otherDriver.token()),
                HttpStatus.CREATED)
            .get("id")
            .asText();
    substantiate(againstRiderRole);

    substantiate(reports.get(0)); // day 0
    advance(Duration.ofDays(60));
    substantiate(reports.get(1)); // day 60
    // An unsubstantiated outcome never counts.
    resolve(reports.get(3), "unsubstantiated");
    advance(Duration.ofDays(30).plusSeconds(1));
    substantiate(reports.get(2)); // day 90 + 1 s: the day-0 one has slid out of the window
    assertThat(flags(driver.userId())).isEmpty();

    Account rider = newRider();
    UUID ride =
        ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
    String fifth =
        ok(post(reportUrl(ride), report("other", List.of()), rider.token()), HttpStatus.CREATED)
            .get("id")
            .asText();
    substantiate(fifth); // day 90: day 60, day 90 and now -> 3 in the window
    assertThat(flags(driver.userId())).hasSize(1);
    Map<String, Object> flag = flags(driver.userId()).get(0);
    assertThat(flag.get("kind")).isEqualTo("report_threshold");
    assertThat(flag.get("role")).isEqualTo("driver");
    assertThat((String) flag.get("details"))
        .contains("\"threshold\": 3", "\"windowDays\": 90", "\"substantiatedCount\": 3")
        .contains(reports.get(1), reports.get(2), fifth)
        .doesNotContain(reports.get(0));
    // Flag only: both roles stay active.
    assertThat(roleRow(driver.userId(), "driver").get("state")).isEqualTo("active");
    assertThat(roleRow(driver.userId(), "rider").get("state")).isEqualTo("active");
    JsonNode trust =
        ok(get("/api/v1/admin/users/" + driver.userId() + "/trust", admin), HttpStatus.OK);
    JsonNode driverRole = TrustRatingsIntegrationTest.roleTrust(trust, "driver");
    assertThat(driverRole.get("openFlags")).hasSize(1);
    assertThat(driverRole.get("reportHistory").get("reportsAgainst").asInt()).isEqualTo(5);
    assertThat(driverRole.get("reportHistory").get("substantiatedAgainst").asInt()).isEqualTo(4);
    JsonNode riderRole = TrustRatingsIntegrationTest.roleTrust(trust, "rider");
    assertThat(riderRole.get("openFlags")).isEmpty();
    assertThat(riderRole.get("reportHistory").get("substantiatedAgainst").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("RBAC: reports:view lists, reports:handle resolves; others get 403")
  void shouldGateTheReportsQueue() {
    Account rider = newRider();
    Account driver = newDriver();
    UUID ride =
        ride(rider.userId(), driver.userId(), "accepted", CLOCK.instant(), null, null, null);
    String reportId =
        ok(post(reportUrl(ride), report("other", List.of()), rider.token()), HttpStatus.CREATED)
            .get("id")
            .asText();
    String powerless = powerlessAdmin("+963937650021");
    assertThat(get("/api/v1/admin/reports", powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/reports/" + reportId, powerless).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            post(
                    "/api/v1/admin/reports/" + reportId + "/resolve",
                    Map.of("outcome", "unsubstantiated", "note", "n"),
                    powerless)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/reports", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM reports WHERE report_id = ?::uuid", String.class, reportId))
        .isEqualTo("open");
  }

  private void substantiate(String reportId) {
    resolve(reportId, "substantiated");
  }

  private void resolve(String reportId, String outcome) {
    ok(
        post(
            "/api/v1/admin/reports/" + reportId + "/resolve",
            Map.of("outcome", outcome, "note", "Investigated"),
            admin),
        HttpStatus.OK);
  }

  private static String reportUrl(UUID rideId) {
    return "/api/v1/rides/" + rideId + "/reports";
  }

  private static Map<String, Object> report(String category, List<UUID> photos) {
    Map<String, Object> body = new HashMap<>();
    body.put("category", category);
    body.put("photoFileIds", photos.stream().map(UUID::toString).toList());
    return body;
  }

  private UUID photo(Account account) {
    ResponseEntity<JsonNode> response = uploadPhoto(account.token(), PNG);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    return UUID.fromString(response.getBody().get("fileId").asText());
  }

  private boolean fileExists(UUID fileId) {
    return jdbcTemplate.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM stored_files WHERE stored_file_id = ?)",
        Boolean.class,
        fileId);
  }

  private ResponseEntity<JsonNode> uploadPhoto(String token, byte[] content) {
    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    if (content != null) {
      HttpHeaders partHeaders = new HttpHeaders();
      partHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
      body.add(
          "file",
          new HttpEntity<>(
              new ByteArrayResource(content) {
                @Override
                public String getFilename() {
                  return "photo.bin";
                }
              },
              partHeaders));
    }
    HttpHeaders headers = bearer(token);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    return restTemplate.exchange(
        "/api/v1/report-files", HttpMethod.POST, new HttpEntity<>(body, headers), JsonNode.class);
  }
}
