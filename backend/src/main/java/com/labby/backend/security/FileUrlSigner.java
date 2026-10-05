package com.labby.backend.security;

import com.labby.backend.config.AuthProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Signs and verifies expiring file-access tokens for the local storage provider (NFR-S2). A token
 * is {@code base64url(key \n contentType \n expiresEpochSeconds) . base64url(HMAC-SHA256)}; it is
 * the capability itself (the admin document viewer loads files via {@code <img src>}, which cannot
 * carry a Bearer header), so it is only minted behind authenticated, permission-checked endpoints
 * and dies after a short TTL. The HMAC key is derived from {@code JWT_SECRET} under a dedicated
 * label, so a file token can never be confused with a JWT and no extra secret is needed.
 */
@Component
public class FileUrlSigner {

  private static final String ALGORITHM = "HmacSHA256";
  private static final String KEY_LABEL = "labby-file-url-v1";
  private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

  private final byte[] key;
  private final Clock clock;

  public FileUrlSigner(AuthProperties authProperties, Clock clock) {
    this.key =
        hmac(
            authProperties.jwtSecret().getBytes(StandardCharsets.UTF_8),
            KEY_LABEL.getBytes(StandardCharsets.UTF_8));
    this.clock = clock;
  }

  /**
   * Mints a token for a stored file.
   *
   * @param storageKey the storage key
   * @param contentType the media type to serve the bytes with
   * @param expiresAt when the token stops verifying
   * @return the URL-safe token
   */
  public String sign(String storageKey, String contentType, Instant expiresAt) {
    String payload = storageKey + "\n" + contentType + "\n" + expiresAt.getEpochSecond();
    byte[] payloadBytes = payload.getBytes(StandardCharsets.UTF_8);
    return ENCODER.encodeToString(payloadBytes)
        + "."
        + ENCODER.encodeToString(hmac(key, payloadBytes));
  }

  /**
   * Verifies a token's signature and expiry.
   *
   * @param token the token from the URL
   * @return the signed file, or empty when the token is malformed, tampered with, or expired
   */
  public Optional<SignedFile> verify(String token) {
    if (token == null) {
      return Optional.empty();
    }
    int dot = token.indexOf('.');
    if (dot <= 0 || dot != token.lastIndexOf('.')) {
      return Optional.empty();
    }
    byte[] payloadBytes;
    byte[] signature;
    try {
      payloadBytes = DECODER.decode(token.substring(0, dot));
      signature = DECODER.decode(token.substring(dot + 1));
    } catch (IllegalArgumentException ex) {
      return Optional.empty();
    }
    if (!MessageDigest.isEqual(hmac(key, payloadBytes), signature)) {
      return Optional.empty();
    }
    String[] parts = new String(payloadBytes, StandardCharsets.UTF_8).split("\n", -1);
    if (parts.length != 3) {
      return Optional.empty();
    }
    long expiresEpoch;
    try {
      expiresEpoch = Long.parseLong(parts[2]);
    } catch (NumberFormatException ex) {
      return Optional.empty();
    }
    if (!clock.instant().isBefore(Instant.ofEpochSecond(expiresEpoch))) {
      return Optional.empty();
    }
    return Optional.of(new SignedFile(parts[0], parts[1]));
  }

  private static byte[] hmac(byte[] secret, byte[] data) {
    try {
      Mac mac = Mac.getInstance(ALGORITHM);
      mac.init(new SecretKeySpec(secret, ALGORITHM));
      return mac.doFinal(data);
    } catch (GeneralSecurityException ex) {
      throw new IllegalStateException("HMAC-SHA256 unavailable", ex);
    }
  }

  /**
   * A verified token's target.
   *
   * @param storageKey the storage key
   * @param contentType the media type to serve
   */
  public record SignedFile(String storageKey, String contentType) {}
}
