package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Deny-by-default chain with the exact public whitelist (NFR-S3). */
class SecuritySmokeIntegrationTest extends AbstractAuthIntegrationTest {

  @Test
  @DisplayName("anonymous GET /users/me answers 401 with the JSON error shape")
  void shouldRejectAnonymousWhenProtectedEndpointCalled() {
    ResponseEntity<String> response = restTemplate.getForEntity("/api/v1/users/me", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(response.getBody()).contains("\"status\":401");
  }

  @Test
  @DisplayName("a garbage bearer token stays anonymous -> 401")
  void shouldRejectRequestWhenBearerTokenInvalid() {
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth("not-a-jwt");

    ResponseEntity<String> response =
        restTemplate.exchange(
            "/api/v1/users/me", HttpMethod.GET, new HttpEntity<>(headers), String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  @DisplayName("whitelisted endpoints stay public: meta, health, api-docs")
  void shouldServePublicEndpointsWhenAnonymous() {
    assertThat(restTemplate.getForEntity("/api/v1/meta", String.class).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(restTemplate.getForEntity("/actuator/health", String.class).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(restTemplate.getForEntity("/v3/api-docs", String.class).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("non-whitelisted actuator endpoints are not public")
  void shouldRejectAnonymousWhenActuatorInfoCalled() {
    ResponseEntity<String> response = restTemplate.getForEntity("/actuator/info", String.class);
    assertThat(response.getStatusCode()).isIn(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND);
  }
}
