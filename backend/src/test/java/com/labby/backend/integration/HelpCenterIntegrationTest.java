package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M14-T2 help center (SUP-04, UC-S-21, UC-A-23) through the API: publishing blocked on ANY missing
 * language with the blank fields named, immediate visibility and unpublish, the content:* gating,
 * ordering of categories and articles, the public reads in both languages and the substring search
 * with its ordering.
 */
class HelpCenterIntegrationTest extends AbstractSupportIntegrationTest {

  private UUID helpCategory(String nameEn) {
    return UUID.fromString(
        ok(
                post(
                    "/api/v1/admin/help/categories",
                    Map.of("nameEn", nameEn, "nameAr", "قسم " + nameEn),
                    admin),
                HttpStatus.CREATED)
            .get("helpCategoryId")
            .asText());
  }

  private static Map<String, Object> article(
      UUID categoryId, String titleEn, String titleAr, String bodyEn, String bodyAr) {
    Map<String, Object> body = new HashMap<>();
    body.put("helpCategoryId", categoryId.toString());
    body.put("titleEn", titleEn);
    body.put("titleAr", titleAr);
    body.put("bodyEn", bodyEn);
    body.put("bodyAr", bodyAr);
    return body;
  }

  private String draft(Map<String, Object> body) {
    return ok(post("/api/v1/admin/help/articles", body, admin), HttpStatus.CREATED)
        .get("helpArticleId")
        .asText();
  }

  private ResponseEntity<JsonNode> patch(String url, Object body, String token) {
    return restTemplate.exchange(url, HttpMethod.PATCH, authorized(body, token), JsonNode.class);
  }

  private String published(
      UUID categoryId, String titleEn, String titleAr, String bodyEn, String bodyAr) {
    String id = draft(article(categoryId, titleEn, titleAr, bodyEn, bodyAr));
    ok(post("/api/v1/admin/help/articles/" + id + "/publish", null, admin), HttpStatus.OK);
    return id;
  }

  @Test
  @DisplayName(
      "UC-A-23 E1 / milestone AC: publishing is impossible while any of the four texts is blank;"
          + " a published article cannot lose a text; unpublish hides it at once")
  void shouldBlockPublishingOnAMissingLanguage() {
    Account rider = newRider();
    String handler = handler();
    UUID payments = helpCategory("Payments");
    assertThat(
            post("/api/v1/admin/help/categories", Map.of("nameEn", "X", "nameAr", "س"), handler)
                .getStatusCode())
        .as("content:manage is not support:handle")
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(get("/api/v1/admin/help/categories", handler).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);

    JsonNode created =
        ok(
            post(
                "/api/v1/admin/help/articles",
                article(payments, "How to pay", null, null, null),
                admin),
            HttpStatus.CREATED);
    String id = created.get("helpArticleId").asText();
    assertThat(created.get("status").asText()).isEqualTo("draft");
    List<String> missing = new ArrayList<>();
    created.get("missing").forEach(node -> missing.add(node.asText()));
    assertThat(missing).containsExactly("titleAr", "bodyEn", "bodyAr");

    ResponseEntity<JsonNode> refused =
        post("/api/v1/admin/help/articles/" + id + "/publish", null, admin);
    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(refused)).isEqualTo("translation_missing");
    assertThat(refused.getBody().get("details").get("missing")).hasSize(3);
    assertThat(ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK)).isEmpty();

    ok(
        patch(
            "/api/v1/admin/help/articles/" + id,
            article(payments, "How to pay", "كيف تدفع", "Pay cash or wallet.", "  "),
            admin),
        HttpStatus.OK);
    ResponseEntity<JsonNode> stillRefused =
        post("/api/v1/admin/help/articles/" + id + "/publish", null, admin);
    assertThat(code(stillRefused)).isEqualTo("translation_missing");
    assertThat(stillRefused.getBody().get("details").get("missing").get(0).asText())
        .isEqualTo("bodyAr");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT status FROM help_articles WHERE help_article_id = ?",
                String.class,
                UUID.fromString(id)))
        .isEqualTo("draft");

    ok(
        patch(
            "/api/v1/admin/help/articles/" + id,
            article(
                payments,
                "How to pay",
                "كيف تدفع",
                "Pay cash or wallet.",
                "ادفع نقداً أو من المحفظة."),
            admin),
        HttpStatus.OK);
    JsonNode live =
        ok(post("/api/v1/admin/help/articles/" + id + "/publish", null, admin), HttpStatus.OK);
    assertThat(live.get("status").asText()).isEqualTo("published");
    assertThat(live.get("publishedAt").isNull()).isFalse();
    assertThat(live.get("missing")).isEmpty();
    // Idempotent; audited.
    ok(post("/api/v1/admin/help/articles/" + id + "/publish", null, admin), HttpStatus.OK);
    assertThat(auditActions(id))
        .contains("help_article.create", "help_article.update", "help_article.publish");

    // Visible at once, both languages in one payload.
    JsonNode categories = ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK);
    assertThat(categories).hasSize(1);
    assertThat(categories.get(0).get("name").get("ar").asText()).isEqualTo("قسم Payments");
    assertThat(categories.get(0).get("articleCount").asInt()).isEqualTo(1);
    JsonNode full = ok(get("/api/v1/help/articles/" + id, rider.token()), HttpStatus.OK);
    assertThat(full.get("title").get("ar").asText()).isEqualTo("كيف تدفع");
    assertThat(full.get("body").get("en").asText()).isEqualTo("Pay cash or wallet.");
    // A published article keeps all four texts: blanking one is refused.
    ResponseEntity<JsonNode> blanked =
        patch(
            "/api/v1/admin/help/articles/" + id,
            article(payments, "How to pay", "", "Pay cash or wallet.", "ادفع."),
            admin);
    assertThat(blanked.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(blanked)).isEqualTo("translation_missing");
    // Editing a published article applies immediately.
    ok(
        patch(
            "/api/v1/admin/help/articles/" + id,
            article(payments, "How to pay", "كيف تدفع", "Pay cash, wallet or card.", "ادفع."),
            admin),
        HttpStatus.OK);
    assertThat(
            ok(get("/api/v1/help/articles/" + id, rider.token()), HttpStatus.OK)
                .get("body")
                .get("en")
                .asText())
        .isEqualTo("Pay cash, wallet or card.");

    JsonNode back =
        ok(post("/api/v1/admin/help/articles/" + id + "/unpublish", null, admin), HttpStatus.OK);
    assertThat(back.get("status").asText()).isEqualTo("draft");
    assertThat(back.get("publishedAt").isNull()).isTrue();
    assertThat(get("/api/v1/help/articles/" + id, rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(
            get("/api/v1/help/categories/" + payments + "/articles", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK)).isEmpty();
    assertThat(ok(get("/api/v1/admin/help/articles?status=draft", admin), HttpStatus.OK))
        .hasSize(1);

    // Draft rules: a working title in some language; bodies capped at 20,000.
    ResponseEntity<JsonNode> untitled =
        post("/api/v1/admin/help/articles", article(payments, " ", null, "x", null), admin);
    assertThat(untitled.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(untitled)).isEqualTo("title_required");
    ResponseEntity<JsonNode> tooLong =
        post(
            "/api/v1/admin/help/articles",
            article(payments, "Long", null, "x".repeat(20001), null),
            admin);
    assertThat(tooLong.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(tooLong)).isEqualTo("body_too_long");
    assertThat(
            post(
                    "/api/v1/admin/help/articles",
                    article(UUID.randomUUID(), "Lost", null, null, null),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    // A category with articles cannot be deleted; empty ones can.
    ResponseEntity<JsonNode> notEmpty = delete("/api/v1/admin/help/categories/" + payments, admin);
    assertThat(notEmpty.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(notEmpty)).isEqualTo("category_not_empty");
    assertThat(delete("/api/v1/admin/help/articles/" + id, admin).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(delete("/api/v1/admin/help/categories/" + payments, admin).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(auditActions(payments.toString()))
        .contains("help_category.create", "help_category.delete");
  }

  @Test
  @DisplayName("SUP-04 / UC-S-21: ordered public reads and a substring search, titles first")
  void shouldServeOrderedReadsAndSearch() {
    Account rider = newRider();
    UUID account = helpCategory("Account");
    UUID rides = helpCategory("Rides");
    UUID empty = helpCategory("Empty");
    String password =
        published(
            account,
            "Reset your password",
            "إعادة تعيين كلمة المرور",
            "Open settings and tap reset.",
            "افتح الإعدادات.");
    String phone =
        published(
            account,
            "Change your phone",
            "تغيير رقم الهاتف",
            "Your password stays the same.",
            "تبقى كلمة المرور كما هي.");
    String cancel =
        published(
            rides,
            "Cancel a ride",
            "إلغاء رحلة",
            "Cancelling after the grace costs a fee.",
            "الإلغاء بعد المهلة له رسوم.");
    draft(article(rides, "Draft about passwords", null, "password", null));

    // Categories hold at least one published article; ordered by sortOrder (creation order).
    JsonNode categories = ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK);
    List<String> ids = new ArrayList<>();
    categories.forEach(node -> ids.add(node.get("helpCategoryId").asText()));
    assertThat(ids).containsExactly(account.toString(), rides.toString());
    assertThat(get("/api/v1/help/categories/" + empty + "/articles", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);
    // Reorder categories (every id exactly once) and articles.
    ResponseEntity<JsonNode> incomplete =
        put("/api/v1/admin/help/categories/order", Map.of("ids", List.of(rides.toString())), admin);
    assertThat(incomplete.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    assertThat(code(incomplete)).isEqualTo("order_incomplete");
    assertThat(
            put(
                    "/api/v1/admin/help/categories/order",
                    Map.of("ids", List.of(rides.toString(), empty.toString(), account.toString())),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    ids.clear();
    ok(get("/api/v1/help/categories", rider.token()), HttpStatus.OK)
        .forEach(node -> ids.add(node.get("helpCategoryId").asText()));
    assertThat(ids).containsExactly(rides.toString(), account.toString());
    assertThat(
            put(
                    "/api/v1/admin/help/categories/" + account + "/articles/order",
                    Map.of("ids", List.of(phone, password)),
                    admin)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    JsonNode accountArticles =
        ok(get("/api/v1/help/categories/" + account + "/articles", rider.token()), HttpStatus.OK);
    assertThat(accountArticles).hasSize(2);
    assertThat(accountArticles.get(0).get("helpArticleId").asText()).isEqualTo(phone);
    assertThat(accountArticles.get(0).get("title").get("en").asText())
        .isEqualTo("Change your phone");
    assertThat(accountArticles.get(0).has("body")).isFalse();
    JsonNode adminList = ok(get("/api/v1/admin/help/articles", admin), HttpStatus.OK);
    assertThat(adminList).hasSize(4);
    assertThat(adminList.get(0).get("helpCategoryId").asText())
        .as("category order first")
        .isEqualTo(rides.toString());
    JsonNode adminCategories = ok(get("/api/v1/admin/help/categories", admin), HttpStatus.OK);
    assertThat(adminCategories.get(0).get("articleCount").asInt()).isEqualTo(2);
    assertThat(adminCategories.get(0).get("publishedCount").asInt()).isEqualTo(1);

    // Search: title matches first (in category order), then body matches; drafts never.
    ResponseEntity<JsonNode> tooShort = get("/api/v1/help/search?q=p&lang=en", rider.token());
    assertThat(tooShort.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(code(tooShort)).isEqualTo("query_too_short");
    assertThat(get("/api/v1/help/search?q=password&lang=fr", rider.token()).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    JsonNode hits = ok(get("/api/v1/help/search?q=PASSword&lang=en", rider.token()), HttpStatus.OK);
    List<String> hitIds = new ArrayList<>();
    hits.forEach(node -> hitIds.add(node.get("helpArticleId").asText()));
    assertThat(hitIds).containsExactly(password, phone);
    hitIds.clear();
    ok(get("/api/v1/help/search?q=كلمة المرور&lang=ar", rider.token()), HttpStatus.OK)
        .forEach(node -> hitIds.add(node.get("helpArticleId").asText()));
    assertThat(hitIds).containsExactly(password, phone);
    assertThat(
            ok(get("/api/v1/help/search?q=grace&lang=en&size=1", rider.token()), HttpStatus.OK)
                .get(0)
                .get("helpArticleId")
                .asText())
        .isEqualTo(cancel);
    assertThat(ok(get("/api/v1/help/search?q=grace&lang=ar", rider.token()), HttpStatus.OK))
        .isEmpty();
    assertThat(ok(get("/api/v1/help/search?q=100% off&lang=en", rider.token()), HttpStatus.OK))
        .as("wildcards are literal")
        .isEmpty();
  }
}
