package com.labby.backend.security;

import com.labby.backend.config.AuthProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Component;

/**
 * HS256 JWTs (NFR-S1): short-lived access tokens carrying user id, session id, and roles, plus
 * short-lived purpose-scoped tokens (registration, reset) that are never usable as access tokens —
 * every parse checks the {@code typ} claim.
 */
@Component
public class JwtService {

  private static final String CLAIM_TYPE = "typ";
  private static final String CLAIM_ROLES = "roles";
  private static final String CLAIM_SESSION = "sid";
  private static final String CLAIM_PHONE = "phone";
  private static final String TYPE_ACCESS = "access";
  private static final String TYPE_REGISTRATION = "registration";
  private static final String TYPE_RESET = "reset";
  private static final Duration SCOPED_TOKEN_TTL = Duration.ofMinutes(15);

  private final SecretKey key;
  private final long accessTtlSeconds;

  public JwtService(AuthProperties authProperties) {
    this.key =
        io.jsonwebtoken.security.Keys.hmacShaKeyFor(
            authProperties.jwtSecret().getBytes(StandardCharsets.UTF_8));
    this.accessTtlSeconds = authProperties.accessTtlSeconds();
  }

  /**
   * Issues an access token.
   *
   * @param userId the account id (subject)
   * @param sessionId the refresh-token row id of the session this access token belongs to
   * @param roles the account's role values
   * @return the signed compact JWT
   */
  public String issueAccessToken(UUID userId, UUID sessionId, List<String> roles) {
    Instant now = Instant.now();
    return Jwts.builder()
        .subject(userId.toString())
        .claim(CLAIM_TYPE, TYPE_ACCESS)
        .claim(CLAIM_SESSION, sessionId.toString())
        .claim(CLAIM_ROLES, roles)
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(accessTtlSeconds)))
        .signWith(key)
        .compact();
  }

  /**
   * Parses and validates an access token.
   *
   * @param token the compact JWT
   * @return the claims, or empty when the token is invalid, expired, or not an access token
   */
  public Optional<AccessClaims> parseAccessToken(String token) {
    return parse(token, TYPE_ACCESS)
        .map(
            claims ->
                new AccessClaims(
                    UUID.fromString(claims.getSubject()),
                    UUID.fromString(claims.get(CLAIM_SESSION, String.class)),
                    toRoleList(claims),
                    claims.getExpiration().toInstant()));
  }

  /**
   * Issues the short-lived registration token returned by {@code /register/verify} (mode new).
   *
   * @param phone the OTP-verified phone
   * @return the signed compact JWT
   */
  public String issueRegistrationToken(String phone) {
    return issueScopedToken(TYPE_REGISTRATION, phone, null);
  }

  /**
   * Parses a registration token.
   *
   * @param token the compact JWT
   * @return the verified phone, or empty when invalid/expired/wrong type
   */
  public Optional<String> parseRegistrationToken(String token) {
    return parse(token, TYPE_REGISTRATION).map(claims -> claims.get(CLAIM_PHONE, String.class));
  }

  /**
   * Issues the short-lived reset token returned by {@code /password-reset/verify}.
   *
   * @param userId the account whose reset OTP was verified
   * @return the signed compact JWT
   */
  public String issueResetToken(UUID userId) {
    return issueScopedToken(TYPE_RESET, null, userId);
  }

  /**
   * Parses a reset token.
   *
   * @param token the compact JWT
   * @return the account id, or empty when invalid/expired/wrong type
   */
  public Optional<UUID> parseResetToken(String token) {
    return parse(token, TYPE_RESET).map(claims -> UUID.fromString(claims.getSubject()));
  }

  private String issueScopedToken(String type, String phone, UUID subject) {
    Instant now = Instant.now();
    var builder =
        Jwts.builder()
            .claim(CLAIM_TYPE, type)
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(SCOPED_TOKEN_TTL)))
            .signWith(key);
    if (phone != null) {
      builder.claim(CLAIM_PHONE, phone);
    }
    if (subject != null) {
      builder.subject(subject.toString());
    }
    return builder.compact();
  }

  private Optional<Claims> parse(String token, String expectedType) {
    try {
      Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
      if (!expectedType.equals(claims.get(CLAIM_TYPE, String.class))) {
        return Optional.empty();
      }
      return Optional.of(claims);
    } catch (JwtException | IllegalArgumentException ex) {
      return Optional.empty();
    }
  }

  private static List<String> toRoleList(Claims claims) {
    List<?> raw = claims.get(CLAIM_ROLES, List.class);
    return raw == null ? List.of() : raw.stream().map(String::valueOf).toList();
  }

  /**
   * Validated access-token claims.
   *
   * @param userId the account id
   * @param sessionId the refresh-token row id of the issuing session
   * @param roles the role values embedded at issue time
   * @param expiresAt when the token expires (the realtime socket closes then unless re-authed)
   */
  public record AccessClaims(UUID userId, UUID sessionId, List<String> roles, Instant expiresAt) {}
}
