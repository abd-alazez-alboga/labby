package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.AccountState;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.Role;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Full registration, login, profile, and session-rotation flows (AUTH-01/02, NFR-S1). */
class AuthFlowIntegrationTest extends AbstractAuthIntegrationTest {

  @Test
  @DisplayName("register -> login -> GET /users/me round-trips the account")
  void shouldServeProfileWhenRegisteredAndLoggedIn() {
    String phone = "+963911100001";
    register(phone, "Secret123!", "Test Rider");

    AuthTokensResponseDto session = login(phone, "Secret123!", ClientType.RIDER);
    assertThat(session.user().phone()).isEqualTo(phone);

    ResponseEntity<UserProfileDto> me =
        restTemplate.exchange(
            "/api/v1/users/me",
            HttpMethod.GET,
            new HttpEntity<>(bearer(session.accessToken())),
            UserProfileDto.class);
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).isNotNull();
    assertThat(me.getBody().name()).isEqualTo("Test Rider");
    assertThat(me.getBody().language()).isEqualTo(Language.EN);
    assertThat(me.getBody().state()).isEqualTo(AccountState.ACTIVE);
    assertThat(me.getBody().roles()).hasSize(1);
    assertThat(me.getBody().roles().get(0).role()).isEqualTo(Role.RIDER);
  }

  @Test
  @DisplayName("password and OTP are stored bcrypt-hashed, never plain (NFR-S1)")
  void shouldStoreOnlyHashesWhenRegistering() {
    String phone = "+963911100002";
    restTemplate.postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class);
    String code = lastCodeFor(phone);

    String codeHash =
        jdbcTemplate.queryForObject(
            "SELECT code_hash FROM otp_codes WHERE phone = ?", String.class, phone);
    assertThat(codeHash).startsWith("$2").doesNotContain(code);

    register("+963911100003", "Secret123!", "Hash Check");
    String passwordHash =
        jdbcTemplate.queryForObject(
            "SELECT password_hash FROM users WHERE phone = ?", String.class, "+963911100003");
    assertThat(passwordHash).startsWith("$2").doesNotContain("Secret123!");
  }

  @Test
  @DisplayName("register start on a usable account answers 409")
  void shouldRejectRegisterStartWhenPhoneRegistered() {
    String phone = "+963911100004";
    register(phone, "Secret123!", "Taken");

    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/auth/register/start", Map.of("phone", phone), String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
  }

  @Test
  @DisplayName("wrong OTP answers 400 per attempt and 410 once attempts are exhausted")
  void shouldExhaustOtpAttemptsWhenCodeWrong() {
    String phone = "+963911100005";
    restTemplate.postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class);

    for (int attempt = 0; attempt < 5; attempt++) {
      ResponseEntity<String> wrong =
          restTemplate.postForEntity(
              "/api/v1/auth/register/verify",
              Map.of("phone", phone, "code", "000000"),
              String.class);
      assertThat(wrong.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // Even the RIGHT code is gone after 5 wrong attempts.
    ResponseEntity<String> exhausted =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            String.class);
    assertThat(exhausted.getStatusCode()).isEqualTo(HttpStatus.GONE);
  }

  @Test
  @DisplayName("expired OTP answers 410")
  void shouldRejectOtpWhenExpired() {
    String phone = "+963911100006";
    restTemplate.postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class);
    jdbcTemplate.update(
        "UPDATE otp_codes SET expires_at = now() - interval '1 minute' WHERE phone = ?", phone);

    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GONE);
  }

  @Test
  @DisplayName("refresh rotates; reuse of the rotated token revokes the whole family")
  void shouldRevokeFamilyWhenRotatedTokenReused() {
    String phone = "+963911100007";
    register(phone, "Secret123!", "Rotator");
    AuthTokensResponseDto first = login(phone, "Secret123!", ClientType.RIDER);

    ResponseEntity<AuthTokensResponseDto> second =
        restTemplate.postForEntity(
            "/api/v1/auth/refresh",
            Map.of("refreshToken", first.refreshToken()),
            AuthTokensResponseDto.class);
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(second.getBody()).isNotNull();
    assertThat(second.getBody().refreshToken()).isNotEqualTo(first.refreshToken());

    // Reuse of the OLD (rotated) token -> 401 and family revocation.
    ResponseEntity<String> reuse =
        restTemplate.postForEntity(
            "/api/v1/auth/refresh", Map.of("refreshToken", first.refreshToken()), String.class);
    assertThat(reuse.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

    // The rotated-to token was revoked with the family.
    ResponseEntity<String> familyMember =
        restTemplate.postForEntity(
            "/api/v1/auth/refresh",
            Map.of("refreshToken", second.getBody().refreshToken()),
            String.class);
    assertThat(familyMember.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  @DisplayName("logout revokes the refresh token")
  void shouldRejectRefreshWhenLoggedOut() {
    String phone = "+963911100008";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Leaver");

    ResponseEntity<Void> logout =
        restTemplate.postForEntity(
            "/api/v1/auth/logout", Map.of("refreshToken", session.refreshToken()), Void.class);
    assertThat(logout.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

    ResponseEntity<String> refresh =
        restTemplate.postForEntity(
            "/api/v1/auth/refresh", Map.of("refreshToken", session.refreshToken()), String.class);
    assertThat(refresh.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  @DisplayName("driver client logs in with a rider-only account (gate is in-app)")
  void shouldAllowDriverClientWhenOnlyRiderRole() {
    String phone = "+963911100009";
    register(phone, "Secret123!", "Rider Only");

    assertThat(tryLogin(phone, "Secret123!", ClientType.DRIVER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(tryLogin(phone, "Secret123!", ClientType.ADMIN).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }
}
