package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.MetaResponseDto;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Integration test for the meta endpoint against the real application context. */
class MetaIntegrationTest extends AbstractIntegrationTest {

  @Autowired private TestRestTemplate restTemplate;

  @Autowired private BuildProperties buildProperties;

  @Test
  @DisplayName("should serve name and version from build info")
  void shouldServeMetaWhenApplicationRuns() {
    ResponseEntity<MetaResponseDto> response =
        restTemplate.getForEntity("/api/v1/meta", MetaResponseDto.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().name()).isEqualTo(buildProperties.getName());
    assertThat(response.getBody().version()).isEqualTo(buildProperties.getVersion());
  }
}
