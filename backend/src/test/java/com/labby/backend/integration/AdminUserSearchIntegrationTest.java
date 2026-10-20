package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Review V1 H8 (UC-A-13, ADM-05): {@code GET /admin/users?q=} finds any account — including one
 * that never took a ride — by partial name, by phone in any format, or by user id; it combines with
 * the other filters, and the CSV export follows it.
 */
class AdminUserSearchIntegrationTest extends AbstractSupportIntegrationTest {

  @LocalServerPort private int port;

  /** The list searched with {@code q} sent verbatim (encoded once, so a "+" stays a plus). */
  private List<String> search(String query) {
    URI uri =
        URI.create(
            "http://localhost:"
                + port
                + "/api/v1/admin/users?size=100&q="
                + URLEncoder.encode(query, StandardCharsets.UTF_8).replace("+", "%20"));
    JsonNode page =
        ok(
            restTemplate.exchange(
                uri, HttpMethod.GET, new HttpEntity<>(bearer(admin)), JsonNode.class),
            HttpStatus.OK);
    List<String> ids = new ArrayList<>();
    page.get("items").forEach(item -> ids.add(item.get("userId").asText()));
    assertThat(page.get("totalItems").asLong()).isEqualTo(ids.size());
    return ids;
  }

  @Test
  @DisplayName("a user with no rides is found by partial name, any phone format and id")
  void shouldFindARideLessUserByNamePhoneAndId() {
    Account rana = registerWithoutPhoto("+963944120551", "Rana Khoury");
    Account other = registerWithoutPhoto("+963944120552", "Omar Tarek");
    String id = rana.userId().toString();

    assertThat(search("khour")).containsExactly(id);
    assertThat(search("  RANA KH ")).containsExactly(id);
    assertThat(search("0944 120 551")).containsExactly(id);
    assertThat(search("0944-120-551")).containsExactly(id);
    assertThat(search("963944120551")).containsExactly(id);
    assertThat(search("+963944120551")).containsExactly(id);
    assertThat(search("00963944120551")).containsExactly(id);
    assertThat(search(id)).containsExactly(id);
    assertThat(search(other.userId().toString())).containsExactly(other.userId().toString());
    assertThat(search("Yousef Kh")).isEmpty();
    assertThat(search("0944120")).as("phone matching is exact, never partial").isEmpty();
    assertThat(search("%")).as("LIKE wildcards are literal").isEmpty();
    assertThat(search("   ")).as("blank = no search").contains(id, other.userId().toString());
  }

  @Test
  @DisplayName("the search combines with the role filter and the export follows it")
  void shouldCombineWithFiltersAndExport() {
    Account rana = registerWithoutPhoto("+963944120553", "Rana Haddad");
    Account driver = newDriver();
    jdbcTemplate.update(
        "UPDATE users SET name = 'Samer Haddad' WHERE user_id = ?", driver.userId());

    assertThat(search("haddad"))
        .containsExactlyInAnyOrder(rana.userId().toString(), driver.userId().toString());
    JsonNode drivers = ok(get("/api/v1/admin/users?role=driver&q=haddad", admin), HttpStatus.OK);
    assertThat(drivers.get("items")).hasSize(1);
    assertThat(drivers.get("items").get(0).get("userId").asText())
        .isEqualTo(driver.userId().toString());

    ResponseEntity<byte[]> export =
        restTemplate.exchange(
            "/api/v1/admin/exports/users?q=haddad&role=rider",
            HttpMethod.GET,
            new HttpEntity<>(bearer(admin)),
            byte[].class);
    assertThat(export.getStatusCode()).isEqualTo(HttpStatus.OK);
    String[] lines =
        new String(export.getBody(), StandardCharsets.UTF_8).substring(1).split("\r\n");
    // Header + the two Haddads (the driver also holds the rider role).
    assertThat(lines).hasSize(3);
    assertThat(List.of(lines[1].split(",")[0], lines[2].split(",")[0]))
        .containsExactlyInAnyOrder(rana.userId().toString(), driver.userId().toString());
  }
}
