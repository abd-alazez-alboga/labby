package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M14-T2 feedback (FDBK-01, UC-S-22, UC-A-25) through the API: the fixed catalog and the sending
 * app, the admin browse with its filters, admin tags (normalized, replaced as a set), and the
 * counts-by-category-per-bucket view with empty buckets and zero categories.
 */
class FeedbackIntegrationTest extends AbstractSupportIntegrationTest {

  private static Map<String, Object> feedback(String category, String body, String as) {
    return Map.of("category", category, "body", body, "submittedAs", as);
  }

  @Test
  @DisplayName("FDBK-01 / UC-S-22: a categorized entry from one app, silently recorded")
  void shouldSubmitFeedback() {
    Account rider = newRider();
    Account driver = newDriver();
    ResponseEntity<JsonNode> unknown =
        post("/api/v1/feedback", feedback("praise", "Great app", "rider"), rider.token());
    assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(code(unknown)).isEqualTo("invalid_category");
    assertThat(
            post("/api/v1/feedback", feedback("pricing", "   ", "rider"), rider.token())
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            post("/api/v1/feedback", feedback("pricing", "Too expensive", "driver"), rider.token())
                .getStatusCode())
        .as("a rider-only account cannot submit as the driver app")
        .isEqualTo(HttpStatus.FORBIDDEN);
    JsonNode saved =
        ok(
            post(
                "/api/v1/feedback",
                feedback("feature_request", "Add Apple Pay", "rider"),
                rider.token()),
            HttpStatus.CREATED);
    assertThat(saved.get("category").asText()).isEqualTo("feature_request");
    assertThat(saved.get("submittedAs").asText()).isEqualTo("rider");
    assertThat(saved.get("feedbackId").asText()).isNotBlank();
    ok(
        post(
            "/api/v1/feedback",
            feedback("safety", "Bad lighting at the hub", "driver"),
            driver.token()),
        HttpStatus.CREATED);
    assertThat(outboxEvents(rider.userId())).noneMatch(event -> event.startsWith("feedback"));
    assertThat(get("/api/v1/admin/feedback", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  @DisplayName("UC-A-25: browse with filters, tag entries, and count by category per bucket")
  void shouldBrowseTagAndAggregate() {
    Account rider = newRider();
    Account driver = newDriver();
    String handler = handler();
    String viewer = viewer();
    Instant start = CLOCK.instant().truncatedTo(ChronoUnit.DAYS).plus(Duration.ofHours(10));
    CLOCK.set(start);
    String first =
        ok(
                post(
                    "/api/v1/feedback",
                    feedback("pricing", "Surge is too high", "rider"),
                    rider.token()),
                HttpStatus.CREATED)
            .get("feedbackId")
            .asText();
    ok(
        post(
            "/api/v1/feedback",
            feedback("pricing", "Fares too low for drivers", "driver"),
            driver.token()),
        HttpStatus.CREATED);
    advance(Duration.ofDays(1));
    ok(
        post(
            "/api/v1/feedback", feedback("app_experience", "Love the map", "rider"), rider.token()),
        HttpStatus.CREATED);
    advance(Duration.ofDays(2));
    String last =
        ok(
                post("/api/v1/feedback", feedback("other", "Thanks!", "rider"), rider.token()),
                HttpStatus.CREATED)
            .get("feedbackId")
            .asText();

    JsonNode page = ok(get("/api/v1/admin/feedback", viewer), HttpStatus.OK);
    assertThat(page.get("totalItems").asInt()).isEqualTo(4);
    assertThat(page.get("items").get(0).get("feedbackId").asText())
        .as("newest first")
        .isEqualTo(last);
    assertThat(page.get("items").get(0).get("user").get("name").asText()).isEqualTo("Rana Rider");
    assertThat(page.get("items").get(0).get("user").get("role").asText()).isEqualTo("rider");
    assertThat(page.get("items").get(0).get("tags")).isEmpty();
    assertThat(
            ok(get("/api/v1/admin/feedback?category=pricing", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(2);
    assertThat(
            ok(get("/api/v1/admin/feedback?submittedAs=driver", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    assertThat(
            ok(
                    get(
                        "/api/v1/admin/feedback?from="
                            + start.plus(Duration.ofHours(12))
                            + "&to="
                            + start.plus(Duration.ofDays(2)),
                        viewer),
                    HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);

    // Tags: handlers only; trimmed, lower-cased, deduplicated; replaced as a set; audited.
    assertThat(
            put("/api/v1/admin/feedback/" + first + "/tags", Map.of("tags", List.of("x")), viewer)
                .getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    ResponseEntity<JsonNode> invalid =
        put("/api/v1/admin/feedback/" + first + "/tags", Map.of("tags", List.of("  ")), handler);
    assertThat(invalid.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(invalid)).isEqualTo("tag_invalid");
    assertThat(
            code(
                put(
                    "/api/v1/admin/feedback/" + first + "/tags",
                    Map.of("tags", List.of("x".repeat(31))),
                    handler)))
        .isEqualTo("tag_invalid");
    JsonNode tagged =
        ok(
            put(
                "/api/v1/admin/feedback/" + first + "/tags",
                Map.of("tags", List.of(" Surge ", "surge", "Pricing")),
                handler),
            HttpStatus.OK);
    assertThat(tagged.get("tags")).hasSize(2);
    assertThat(tagged.get("tags").get(0).asText()).isEqualTo("pricing");
    assertThat(tagged.get("tags").get(1).asText()).isEqualTo("surge");
    assertThat(
            ok(get("/api/v1/admin/feedback?tag=SURGE", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isEqualTo(1);
    ok(
        put("/api/v1/admin/feedback/" + first + "/tags", Map.of("tags", List.of("surge")), handler),
        HttpStatus.OK);
    assertThat(
            ok(get("/api/v1/admin/feedback?tag=pricing", viewer), HttpStatus.OK)
                .get("totalItems")
                .asInt())
        .isZero();
    assertThat(auditActions(first)).containsExactly("feedback.tag", "feedback.tag");
    assertThat(
            put(
                    "/api/v1/admin/feedback/" + UUID.randomUUID() + "/tags",
                    Map.of("tags", List.of()),
                    handler)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // Stats: one row per day in [from, to), empty days included, every category present.
    Instant day0 = start.truncatedTo(ChronoUnit.DAYS);
    JsonNode stats =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from="
                    + day0
                    + "&to="
                    + day0.plus(Duration.ofDays(4)),
                viewer),
            HttpStatus.OK);
    assertThat(stats.get("total").asInt()).isEqualTo(4);
    assertThat(stats.get("bucket").asText()).isEqualTo("day");
    assertThat(stats.get("byCategory").get("pricing").asInt()).isEqualTo(2);
    assertThat(stats.get("byCategory").get("safety").asInt()).isZero();
    assertThat(stats.get("byCategory").size()).isEqualTo(6);
    assertThat(stats.get("buckets")).hasSize(4);
    assertThat(stats.get("buckets").get(0).get("start").asText()).isEqualTo(day0.toString());
    assertThat(stats.get("buckets").get(0).get("total").asInt()).isEqualTo(2);
    assertThat(stats.get("buckets").get(0).get("byCategory").get("pricing").asInt()).isEqualTo(2);
    assertThat(stats.get("buckets").get(1).get("byCategory").get("app_experience").asInt())
        .isEqualTo(1);
    assertThat(stats.get("buckets").get(2).get("total").asInt())
        .as("an empty day is listed")
        .isZero();
    assertThat(stats.get("buckets").get(3).get("byCategory").get("other").asInt()).isEqualTo(1);
    JsonNode driverOnly =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from="
                    + day0
                    + "&to="
                    + day0.plus(Duration.ofDays(4))
                    + "&submittedAs=driver",
                viewer),
            HttpStatus.OK);
    assertThat(driverOnly.get("total").asInt()).isEqualTo(1);
    // Week buckets start on Monday (ISO); month buckets on the 1st.
    JsonNode weekly =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from="
                    + day0
                    + "&to="
                    + day0.plus(Duration.ofDays(4))
                    + "&bucket=week",
                viewer),
            HttpStatus.OK);
    assertThat(weekly.get("total").asInt()).isEqualTo(4);
    assertThat(
            Instant.parse(weekly.get("buckets").get(0).get("start").asText())
                .atZone(ZoneOffset.UTC)
                .getDayOfWeek())
        .isEqualTo(java.time.DayOfWeek.MONDAY);
    JsonNode monthly =
        ok(
            get(
                "/api/v1/admin/feedback/stats?from="
                    + day0
                    + "&to="
                    + day0.plus(Duration.ofDays(4))
                    + "&bucket=month",
                viewer),
            HttpStatus.OK);
    assertThat(
            Instant.parse(monthly.get("buckets").get(0).get("start").asText())
                .atZone(ZoneOffset.UTC)
                .getDayOfMonth())
        .isEqualTo(1);
    ResponseEntity<JsonNode> backwards =
        get(
            "/api/v1/admin/feedback/stats?from=" + day0.plus(Duration.ofDays(1)) + "&to=" + day0,
            viewer);
    assertThat(backwards.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(code(backwards)).isEqualTo("range_invalid");
    assertThat(
            code(
                get(
                    "/api/v1/admin/feedback/stats?from="
                        + day0
                        + "&to="
                        + day0.plus(Duration.ofDays(400)),
                    viewer)))
        .isEqualTo("range_invalid");
    assertThat(
            get(
                    "/api/v1/admin/feedback/stats?from="
                        + day0
                        + "&to="
                        + day0.plus(Duration.ofDays(1))
                        + "&bucket=hour",
                    viewer)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }
}
