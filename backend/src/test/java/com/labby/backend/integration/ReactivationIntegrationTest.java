package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.RegisterVerifyResponseDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.RegistrationMode;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Soft delete and deleted-account reactivation (USR-07, UC-S-09). */
class ReactivationIntegrationTest extends AbstractAuthIntegrationTest {

  @Test
  @DisplayName("soft delete -> login 401 -> re-register reactivates with history intact")
  void shouldReactivateWhenDeletedPhoneReRegisters() {
    String phone = "+963911200001";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Phoenix");
    ageOtpCodes(phone);

    // 2FA-gated soft delete.
    String otp = requestTwoFactorCode(session.accessToken(), phone);
    ResponseEntity<Void> delete =
        restTemplate.exchange(
            "/api/v1/users/me",
            HttpMethod.DELETE,
            authorized(Map.of("otpCode", otp), session.accessToken()),
            Void.class);
    assertThat(delete.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

    // Deleted accounts behave as nonexistent on login (401, indistinguishable).
    assertThat(tryLogin(phone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    // Sessions were revoked on delete.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/refresh",
                    Map.of("refreshToken", session.refreshToken()),
                    String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    // Re-register: start is allowed for a deleted account's phone...
    ageOtpCodes(phone);
    assertThat(
            restTemplate
                .postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    // ...and verify reactivates immediately: mode reactivated, no registration token.
    ResponseEntity<RegisterVerifyResponseDto> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            RegisterVerifyResponseDto.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(verify.getBody()).isNotNull();
    assertThat(verify.getBody().mode()).isEqualTo(RegistrationMode.REACTIVATED);
    assertThat(verify.getBody().registrationToken()).isNull();

    // The OLD password still works — the account was reactivated, not recreated.
    AuthTokensResponseDto back = login(phone, "Secret123!", ClientType.RIDER);
    assertThat(back.user().name()).isEqualTo("Phoenix");

    Integer userCount =
        jdbcTemplate.queryForObject(
            "SELECT count(*) FROM users WHERE phone = ?", Integer.class, phone);
    assertThat(userCount).isEqualTo(1);
  }

  @Test
  @DisplayName("password reset start stays neutral for deleted accounts (no SMS)")
  void shouldStayNeutralWhenResetRequestedForDeletedAccount() {
    String phone = "+963911200002";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Gone Soon");
    ageOtpCodes(phone);
    String otp = requestTwoFactorCode(session.accessToken(), phone);
    restTemplate.exchange(
        "/api/v1/users/me",
        HttpMethod.DELETE,
        authorized(Map.of("otpCode", otp), session.accessToken()),
        Void.class);

    int sentBefore = smsCountFor(phone);
    ResponseEntity<Void> reset =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/start", Map.of("phone", phone), Void.class);
    assertThat(reset.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(smsCountFor(phone)).isEqualTo(sentBefore);
  }
}
