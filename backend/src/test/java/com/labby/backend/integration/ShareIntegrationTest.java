package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M10-T2 acceptance — trip sharing (SHARE-01/02, UC-S-15): one unguessable 256-bit link per user
 * per ride during an active accepted ride, hash-only storage, a public JSON endpoint serving
 * exactly the SHARE-02 list with no authentication, 404 for unknown tokens and 410 for ever once
 * the ride is terminal — after completion AND after cancellation — plus the minimal public page.
 */
class ShareIntegrationTest extends AbstractRideIntegrationTest {

  private ResponseEntity<JsonNode> createLink(Account account, UUID rideId) {
    return post("/api/v1/rides/" + rideId + "/share-links", null, account.token());
  }

  /** A public GET with NO Authorization header. */
  private ResponseEntity<JsonNode> publicGet(String path) {
    return restTemplate.exchange(
        path, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), JsonNode.class);
  }

  private static String token(JsonNode link) {
    String url = link.get("url").asText();
    return url.substring(url.lastIndexOf('/') + 1);
  }

  private UUID acceptedRide(Account rider, Account driver) {
    UUID rideId = book(rider);
    dispatchAndAccept(rideId, driver);
    return rideId;
  }

  @Test
  @DisplayName("SHARE-01: 256-bit URL-safe token, hash-only storage, one link per user per ride")
  void shouldCreateUnguessableHashOnlyLink() throws Exception {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);

    JsonNode link = ok(createLink(rider, rideId), HttpStatus.CREATED);
    assertThat(link.get("url").asText())
        .startsWith("http://localhost:8080/share/")
        .doesNotContain(rideId.toString());
    String token = token(link);
    // 256 bits of URL-safe base64 (43 chars, no padding) decode back to 32 random bytes.
    assertThat(token).hasSize(43).matches("[A-Za-z0-9_-]+");
    assertThat(Base64.getUrlDecoder().decode(token)).hasSize(32);
    // Only the SHA-256 hex is stored — never the raw token.
    String storedHash =
        jdbcTemplate.queryForObject(
            "SELECT token_hash FROM trip_share_links WHERE ride_id = ?", String.class, rideId);
    assertThat(storedHash)
        .hasSize(64)
        .isEqualTo(
            HexFormat.of()
                .formatHex(
                    MessageDigest.getInstance("SHA-256")
                        .digest(token.getBytes(StandardCharsets.US_ASCII))))
        .isNotEqualTo(token);

    // One link per user per ride; the driver holds their own.
    ResponseEntity<JsonNode> repeat = createLink(rider, rideId);
    assertThat(repeat.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(repeat)).isEqualTo("already_shared");
    ok(createLink(driver, rideId), HttpStatus.CREATED);

    // A stranger is no party.
    Account stranger = rider();
    assertThat(createLink(stranger, rideId).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("SHARE-01: no link outside an active accepted ride (409 ride_not_active)")
  void shouldRefuseLinkOutsideActiveAcceptedRide() {
    Account rider = rider();
    driverAt(33.501, 36.30);
    UUID rideId = book(rider);
    ResponseEntity<JsonNode> beforeAcceptance = createLink(rider, rideId);
    assertThat(beforeAcceptance.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(code(beforeAcceptance)).isEqualTo("ride_not_active");
  }

  @Test
  @DisplayName("SHARE-02: the public JSON serves exactly the contract list, no auth required")
  void shouldServePublicSharePage() {
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    String token = token(ok(createLink(rider, rideId), HttpStatus.CREATED));

    JsonNode page = ok(publicGet("/api/v1/share/" + token), HttpStatus.OK);
    // EXACTLY the SHARE-02 list — never more fields (no phones, no rider identity, no fare).
    List<String> fields = new ArrayList<>();
    page.fieldNames().forEachRemaining(fields::add);
    assertThat(fields)
        .containsExactlyInAnyOrder(
            "status",
            "driverFirstName",
            "driverPhotoUrl",
            "vehicle",
            "position",
            "etaSeconds",
            "refreshSeconds");
    assertThat(page.get("status").asText()).isEqualTo("accepted");
    assertThat(page.get("driverFirstName").asText()).isEqualTo("Driver");
    assertThat(page.get("vehicle").get("model").asText()).isEqualTo("Rio");
    assertThat(page.get("vehicle").get("color").asText()).isEqualTo("White");
    assertThat(page.get("vehicle").get("plate").asText()).isNotBlank();
    assertThat(page.get("position").get("lat").asDouble()).isEqualTo(33.501);
    assertThat(page.get("refreshSeconds").asInt()).isEqualTo(5);

    // The driver's position goes stale after the realtime window: served as null, never a guess.
    advance(Duration.ofSeconds(31));
    assertThat(ok(publicGet("/api/v1/share/" + token), HttpStatus.OK).get("position").isNull())
        .isTrue();

    // Unknown tokens are 404.
    assertThat(publicGet("/api/v1/share/not-a-real-token").getStatusCode())
        .isEqualTo(HttpStatus.NOT_FOUND);

    // The minimal public web page: no login, Labby purple, polls the data endpoint.
    ResponseEntity<String> html =
        restTemplate.exchange(
            "/share/" + token, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), String.class);
    assertThat(html.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(html.getHeaders().getContentType().toString()).contains("text/html");
    assertThat(html.getBody()).contains("#59128A").contains("/api/v1/share/");
    assertThat(html.getBody()).doesNotContain(token);
  }

  @Test
  @DisplayName("UC-S-15 E1: the link dies for ever at completion and at cancellation (410)")
  void shouldKillLinkAtTerminalState() {
    // Completion.
    Account rider = rider();
    Account driver = driverAt(33.501, 36.30);
    UUID rideId = acceptedRide(rider, driver);
    String token = token(ok(createLink(rider, rideId), HttpStatus.CREATED));
    arriveAndStart(rideId, driver);
    assertThat(ok(publicGet("/api/v1/share/" + token), HttpStatus.OK).get("status").asText())
        .isEqualTo("in_progress");
    position(driver, DEST_LAT, DEST_LNG);
    ok(driverAction(driver, rideId, "complete"), HttpStatus.OK);
    assertThat(publicGet("/api/v1/share/" + token).getStatusCode()).isEqualTo(HttpStatus.GONE);
    // Terminal also means no new link (409 ride_not_active).
    assertThat(code(createLink(driver, rideId))).isEqualTo("ride_not_active");

    // Cancellation after acceptance.
    UUID second = acceptedRide(rider, driver);
    String secondToken = token(ok(createLink(rider, second), HttpStatus.CREATED));
    ok(
        post(
            "/api/v1/rides/" + second + "/cancel", Map.of("reason", "changed_mind"), rider.token()),
        HttpStatus.OK);
    assertThat(publicGet("/api/v1/share/" + secondToken).getStatusCode())
        .isEqualTo(HttpStatus.GONE);
  }
}
