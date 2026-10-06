package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M6-T3: {@code POST /api/v1/routing/route} with OSRM blocked (the test URL refuses connections) —
 * the endpoint still answers with the contract's Route shape, flagged approximate (NFR-A3).
 */
class RoutingIntegrationTest extends AbstractAuthIntegrationTest {

  private ResponseEntity<JsonNode> route(Object body, String token) {
    return restTemplate.postForEntity(
        "/api/v1/routing/route",
        new HttpEntity<>(body, token == null ? null : bearer(token)),
        JsonNode.class);
  }

  private static Map<String, Object> point(double lat, double lng) {
    return Map.of("lat", lat, "lng", lng);
  }

  @Test
  @DisplayName("OSRM blocked → 200 straight-line route flagged approximate, GeoJSON [lng,lat]")
  void shouldFallBackWhenOsrmIsBlocked() {
    String token = register("+963935000001", "Secret123!", "Router").accessToken();

    ResponseEntity<JsonNode> response =
        route(
            Map.of(
                "points",
                List.of(point(33.5130, 36.2765), point(33.5100, 36.3000), point(33.5146, 36.3165))),
            token);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    JsonNode body = response.getBody();
    assertThat(body.get("approximate").asBoolean()).isTrue();
    assertThat(body.get("distanceMeters").asLong()).isPositive();
    assertThat(body.get("durationSeconds").asLong()).isPositive();
    assertThat(body.get("geometry").get("type").asText()).isEqualTo("LineString");
    JsonNode coordinates = body.get("geometry").get("coordinates");
    assertThat(coordinates).hasSize(3);
    assertThat(coordinates.get(0).get(0).asDouble()).isEqualTo(36.2765);
    assertThat(coordinates.get(0).get(1).asDouble()).isEqualTo(33.5130);
  }

  @Test
  @DisplayName("invalid points → 400; unauthenticated → 401")
  void shouldValidatePoints() {
    String token = register("+963935000002", "Secret123!", "Router Two").accessToken();
    Map<String, Object> damascus = point(33.5, 36.3);

    assertThat(route(Map.of("points", List.of(damascus)), token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(
            route(
                    Map.of(
                        "points",
                        List.of(damascus, damascus, damascus, damascus, damascus, damascus)),
                    token)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(route(Map.of("points", List.of(damascus, point(91, 0))), token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(route(Map.of("points", List.of(damascus, Map.of("lat", 1))), token).getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(route(Map.of(), token).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(route(Map.of("points", List.of(damascus, damascus)), null).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }
}
