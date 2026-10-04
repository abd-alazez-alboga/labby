package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Smoke test: context boots against Postgres, Flyway migrates, health endpoint is UP. */
class ApplicationContextIntegrationTest extends AbstractIntegrationTest {

  @Autowired private ApplicationContext applicationContext;
  @Autowired private TestRestTemplate restTemplate;

  @Test
  @DisplayName("application context loads against the Testcontainers Postgres")
  void shouldLoadApplicationContextWhenStartedAgainstPostgres() {
    assertThat(applicationContext).isNotNull();
    assertThat(applicationContext.containsBean("flyway")).isTrue();
  }

  @Test
  @DisplayName("GET /actuator/health returns UP")
  void shouldReturnUpWhenHealthEndpointQueried() {
    ResponseEntity<String> response = restTemplate.getForEntity("/actuator/health", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("\"status\":\"UP\"");
  }
}
