package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.PasswordResetVerifyResponseDto;
import com.labby.backend.enums.ClientType;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Password reset end-to-end (AUTH-03, NFR-S3). */
class PasswordResetIntegrationTest extends AbstractAuthIntegrationTest {

  @Test
  @DisplayName("reset start -> verify -> complete changes the password and revokes sessions")
  void shouldResetPasswordWhenOtpVerified() {
    String phone = "+963911300001";
    AuthTokensResponseDto session = register(phone, "OldSecret1!", "Forgetful");

    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/password-reset/start", Map.of("phone", phone), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    ResponseEntity<PasswordResetVerifyResponseDto> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            PasswordResetVerifyResponseDto.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(verify.getBody()).isNotNull();

    ResponseEntity<Void> complete =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/complete",
            Map.of("resetToken", verify.getBody().resetToken(), "newPassword", "NewSecret1!"),
            Void.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

    // All pre-reset sessions are revoked (AUTH-03).
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/refresh",
                    Map.of("refreshToken", session.refreshToken()),
                    String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    assertThat(tryLogin(phone, "OldSecret1!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
    assertThat(tryLogin(phone, "NewSecret1!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("reset start answers neutral 204 for unknown phones and sends nothing")
  void shouldStayNeutralWhenPhoneUnknown() {
    String phone = "+963911300099";
    ResponseEntity<Void> response =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/start", Map.of("phone", phone), Void.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(smsCountFor(phone)).isZero();
  }

  @Test
  @DisplayName("a reset OTP never validates for registration (purpose-bound, AUTH-04)")
  void shouldRejectResetCodeWhenUsedForRegistration() {
    String phone = "+963911300002";
    register(phone, "Secret123!", "Cross Purpose");
    ageOtpCodes(phone);

    restTemplate.postForEntity(
        "/api/v1/auth/password-reset/start", Map.of("phone", phone), Void.class);
    String resetCode = lastCodeFor(phone);

    // The reset code must not verify a registration — no live register code exists -> 410.
    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", resetCode),
            String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GONE);
  }
}
