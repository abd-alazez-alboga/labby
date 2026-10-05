package com.labby.backend.unit.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.security.FileUrlSigner;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** NFR-S2: expiring file tokens verify only untampered, unexpired, same-secret tokens. */
class FileUrlSignerTest {

  private static final Instant NOW = Instant.parse("2026-10-06T10:00:00Z");
  private static final String KEY = "driver-files/abc.pdf";

  private final FileUrlSigner signer = signerAt(NOW, "unit-test-secret-0123456789abcdef0123");

  @Test
  @DisplayName("a fresh token verifies to its key and content type")
  void shouldVerifyFreshToken() {
    String token = signer.sign(KEY, "application/pdf", NOW.plusSeconds(300));

    assertThat(signer.verify(token)).contains(new FileUrlSigner.SignedFile(KEY, "application/pdf"));
  }

  @Test
  @DisplayName("a token stops verifying at its expiry instant")
  void shouldRejectExpiredToken() {
    String token = signer.sign(KEY, "image/png", NOW.plusSeconds(300));
    String sameSecret = "unit-test-secret-0123456789abcdef0123";

    assertThat(signerAt(NOW.plusSeconds(299), sameSecret).verify(token)).isPresent();
    assertThat(signerAt(NOW.plusSeconds(300), sameSecret).verify(token)).isEmpty();
    assertThat(signerAt(NOW.plusSeconds(3600), sameSecret).verify(token)).isEmpty();
  }

  @Test
  @DisplayName("a tampered payload (other key / later expiry) fails the signature")
  void shouldRejectTamperedPayload() {
    String token = signer.sign(KEY, "image/png", NOW.plusSeconds(300));
    String signature = token.substring(token.indexOf('.') + 1);
    String forgedPayload =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                ("driver-files/someone-else.pdf\nimage/png\n"
                        + NOW.plusSeconds(99_999).getEpochSecond())
                    .getBytes(StandardCharsets.UTF_8));

    assertThat(signer.verify(forgedPayload + "." + signature)).isEmpty();
  }

  @Test
  @DisplayName("a token from another secret, or garbage, never verifies")
  void shouldRejectForeignAndMalformedTokens() {
    String foreign =
        signerAt(NOW, "another-secret-0123456789abcdef0123456")
            .sign(KEY, "image/png", NOW.plusSeconds(300));

    assertThat(signer.verify(foreign)).isEmpty();
    assertThat(signer.verify(null)).isEmpty();
    assertThat(signer.verify("")).isEmpty();
    assertThat(signer.verify("no-dot")).isEmpty();
    assertThat(signer.verify("a.b.c")).isEmpty();
    assertThat(signer.verify("!!!.???")).isEmpty();
  }

  private static FileUrlSigner signerAt(Instant now, String secret) {
    return new FileUrlSigner(
        new AuthProperties(secret, 900, 1_209_600, 10, 900), Clock.fixed(now, ZoneOffset.UTC));
  }
}
