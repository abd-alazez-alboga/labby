package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.enums.ClientType;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.repository.LoginFailureRepository;
import com.labby.backend.service.LoginThrottle;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** OTP cooldown/cap and login throttling surface as 429 (AUTH-04, NFR-S3). */
class RateLimitIntegrationTest extends AbstractAuthIntegrationTest {

  @Autowired private AuthProperties authProperties;
  @Autowired private LoginFailureRepository loginFailureRepository;

  @Test
  @DisplayName("requesting a second OTP inside the 60s cooldown answers 429")
  void shouldRejectResendWhenInsideCooldown() {
    String phone = "+963911500001";
    assertThat(
            restTemplate
                .postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    ResponseEntity<String> resend =
        restTemplate.postForEntity(
            "/api/v1/auth/register/start", Map.of("phone", phone), String.class);
    assertThat(resend.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    assertThat(smsCountFor(phone)).isEqualTo(1);
  }

  @Test
  @DisplayName("the 6th code inside an hour answers 429 (5/phone/hour cap)")
  void shouldRejectIssueWhenHourlyCapReached() {
    String phone = "+963911500002";
    // 5 codes already issued in the last hour (backdated beyond the cooldown window).
    for (int minutesAgo = 2; minutesAgo <= 6; minutesAgo++) {
      jdbcTemplate.update(
          "INSERT INTO otp_codes (otp_code_id, phone, code_hash, purpose, expires_at, created_at)"
              + " VALUES (?, ?, 'x', 'register', now(), now() - (? * interval '1 minute'))",
          UUID.randomUUID(),
          phone,
          minutesAgo);
    }

    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/auth/register/start", Map.of("phone", phone), String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    assertThat(smsCountFor(phone)).isZero();
  }

  @Test
  @DisplayName("repeated failed logins answer 429 after the throttle limit")
  void shouldThrottleLoginWhenFailuresExceedLimit() {
    String phone = "+963911500003";
    register(phone, "Secret123!", "Throttled");

    for (int attempt = 0; attempt < 10; attempt++) {
      assertThat(tryLogin(phone, "WrongPass1!", ClientType.RIDER).getStatusCode())
          .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // The 11th attempt is throttled — even with the CORRECT password.
    assertThat(tryLogin(phone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
  }

  @Test
  @DisplayName("login counters live in the database: a fresh throttle instance sees them")
  void shouldThrottleFromAnyInstanceWhenCountersPersisted() {
    String phone = "+963911500005";
    register(phone, "Secret123!", "Persisted");
    for (int attempt = 0; attempt < 10; attempt++) {
      tryLogin(phone, "WrongPass1!", ClientType.RIDER);
    }

    Map<String, Object> row =
        jdbcTemplate.queryForMap(
            "SELECT client_ip, failures FROM login_failures WHERE phone = ?", phone);
    assertThat(row).containsEntry("failures", 10);
    String clientIp = (String) row.get("client_ip");
    // A second API instance (or this one after a restart) holds nothing in memory.
    LoginThrottle freshInstance = new LoginThrottle(authProperties, loginFailureRepository);
    assertThatThrownBy(() -> freshInstance.check(phone, clientIp))
        .isInstanceOf(TooManyRequestsException.class);
  }

  @Test
  @DisplayName("a passed window stops throttling; the next failure restarts it; success deletes it")
  void shouldRestartWindowWhenExpired() {
    String phone = "+963911500006";
    register(phone, "Secret123!", "Patient");
    for (int attempt = 0; attempt < 10; attempt++) {
      tryLogin(phone, "WrongPass1!", ClientType.RIDER);
    }
    assertThat(tryLogin(phone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

    // The window (LOGIN_THROTTLE_WINDOW_SECONDS, default 900) has passed.
    jdbcTemplate.update(
        "UPDATE login_failures SET window_start = now() - interval '901 seconds' WHERE phone = ?",
        phone);
    assertThat(tryLogin(phone, "WrongPass1!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT failures FROM login_failures WHERE phone = ?", Integer.class, phone))
        .isEqualTo(1);

    assertThat(tryLogin(phone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM login_failures WHERE phone = ?", Integer.class, phone))
        .isZero();
  }

  @Test
  @DisplayName("2FA OTP requests hit the same cooldown (429)")
  void shouldRejectTwoFactorRequestWhenInsideCooldown() {
    String phone = "+963911500004";
    var session = register(phone, "Secret123!", "Eager");
    ageOtpCodes(phone);

    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/users/me/2fa/request",
                    authorized(null, session.accessToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    ResponseEntity<String> second =
        restTemplate.postForEntity(
            "/api/v1/users/me/2fa/request", authorized(null, session.accessToken()), String.class);
    assertThat(second.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
  }
}
