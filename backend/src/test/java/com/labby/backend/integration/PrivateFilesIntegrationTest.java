package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.dto.FileAccessUrlDto;
import com.labby.backend.security.FileUrlSigner;
import com.labby.backend.service.StorageProvider;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * M5-T1 storage design (NFR-S2) end-to-end: a minted URL serves the bytes without a Bearer token,
 * never cached; expired, tampered, foreign and path-probing tokens are plain 404s; the storage
 * directory itself is not served.
 */
class PrivateFilesIntegrationTest extends AbstractIntegrationTest {

  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0};

  @Autowired private TestRestTemplate restTemplate;
  @Autowired private StorageProvider storageProvider;
  @Autowired private AuthProperties authProperties;

  @Test
  @DisplayName("a minted URL serves the file anonymously with no-store + nosniff headers")
  void shouldServeMintedUrl() {
    String key = storeTestFile();
    FileAccessUrlDto access = storageProvider.accessUrl(key, "image/png");

    ResponseEntity<byte[]> response = restTemplate.getForEntity(access.url(), byte[].class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).containsExactly(PNG);
    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE)).isEqualTo("image/png");
    assertThat(response.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL))
        .isEqualTo("private, no-store");
    assertThat(response.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
  }

  @Test
  @DisplayName("expired, tampered, foreign and garbage tokens are 404 — indistinguishably")
  void shouldRefuseInvalidTokens() {
    String key = storeTestFile();
    Instant past = Instant.now().minusSeconds(3600);
    String expired =
        new FileUrlSigner(authProperties, Clock.fixed(past, ZoneOffset.UTC))
            .sign(key, "image/png", past.plusSeconds(300));
    String valid = storageProvider.accessUrl(key, "image/png").url();
    String tampered = valid.substring(0, valid.length() - 2) + (valid.endsWith("AA") ? "BB" : "AA");
    String foreign =
        new FileUrlSigner(
                new AuthProperties("a-completely-different-secret-0123456789", 900, 900, 10, 900),
                Clock.systemUTC())
            .sign(key, "image/png", Instant.now().plusSeconds(300));

    assertThat(get("/api/v1/files/" + expired)).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get(tampered)).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/files/" + foreign)).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/files/not-a-token")).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("a validly signed token for a missing file is also a plain 404")
  void shouldRefuseMissingFile() {
    String url = storageProvider.accessUrl("driver-files/" + UUID.randomUUID(), "image/png").url();
    assertThat(get(url)).isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  @DisplayName("the storage directory is not reachable by path, with or without a token prefix")
  void shouldNotExposeStorageDirectory() {
    String key = storeTestFile();
    assertThat(get("/" + key)).isIn(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND);
    assertThat(get("/api/v1/files/" + key)).isIn(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND);
  }

  private String storeTestFile() {
    return storageProvider.store("driver-files/" + UUID.randomUUID() + ".png", PNG);
  }

  private HttpStatus get(String url) {
    return HttpStatus.valueOf(restTemplate.getForEntity(url, byte[].class).getStatusCode().value());
  }
}
