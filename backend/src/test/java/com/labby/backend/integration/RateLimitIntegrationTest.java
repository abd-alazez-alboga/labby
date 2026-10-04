package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.enums.ClientType;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** OTP cooldown/cap and login throttling surface as 429 (AUTH-04, NFR-S3). */
class RateLimitIntegrationTest extends AbstractAuthIntegrationTest {

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
