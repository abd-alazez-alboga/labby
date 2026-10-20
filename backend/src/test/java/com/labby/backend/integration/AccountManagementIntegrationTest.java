package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.RegisterVerifyResponseDto;
import com.labby.backend.dto.UserProfileDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.OtpPurpose;
import com.labby.backend.service.OtpService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/** Profile edit, 2FA password change, 3-step phone change, photo upload (USR-03, AUTH-05). */
class AccountManagementIntegrationTest extends AbstractAuthIntegrationTest {

  @Autowired private OtpService otpService;

  @Test
  @DisplayName("PUT /users/me updates name and language")
  void shouldUpdateProfileWhenValid() {
    String phone = "+963911400001";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Before Name");

    ResponseEntity<UserProfileDto> response =
        restTemplate.exchange(
            "/api/v1/users/me",
            HttpMethod.PUT,
            authorized(Map.of("name", "After Name", "language", "ar"), session.accessToken()),
            UserProfileDto.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().name()).isEqualTo("After Name");
    assertThat(response.getBody().language()).isEqualTo(Language.AR);
  }

  @Test
  @DisplayName("password change needs current password + 2FA OTP and revokes other sessions")
  void shouldChangePasswordWhenTwoFactorValid() {
    String phone = "+963911400002";
    register(phone, "Secret123!", "Changer");
    AuthTokensResponseDto current = login(phone, "Secret123!", ClientType.RIDER);
    AuthTokensResponseDto other = login(phone, "Secret123!", ClientType.RIDER);
    ageOtpCodes(phone);

    // Wrong current password -> 400, OTP untouched.
    String otp = requestTwoFactorCode(current.accessToken(), phone);
    ResponseEntity<String> wrongCurrent =
        restTemplate.exchange(
            "/api/v1/users/me/password",
            HttpMethod.PUT,
            authorized(
                Map.of(
                    "currentPassword", "WrongPass1!",
                    "otpCode", otp,
                    "newPassword", "NewSecret1!"),
                current.accessToken()),
            String.class);
    assertThat(wrongCurrent.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

    // Correct current password + OTP -> 204.
    ResponseEntity<Void> change =
        restTemplate.exchange(
            "/api/v1/users/me/password",
            HttpMethod.PUT,
            authorized(
                Map.of(
                    "currentPassword", "Secret123!",
                    "otpCode", otp,
                    "newPassword", "NewSecret1!"),
                current.accessToken()),
            Void.class);
    assertThat(change.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

    // The current session survives (AUTH-05). Checked FIRST: using the revoked token below
    // triggers family revocation per the contract, which kills every live session.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/refresh",
                    Map.of("refreshToken", current.refreshToken()),
                    String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);
    // The OTHER session was revoked by the password change.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/refresh",
                    Map.of("refreshToken", other.refreshToken()),
                    String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    assertThat(tryLogin(phone, "NewSecret1!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
  }

  @Test
  @DisplayName("phone change: OTP to current, then OTP to new, then the phone mutates")
  void shouldChangePhoneWhenBothOtpsVerified() {
    String oldPhone = "+963911400003";
    String newPhone = "+963911400004";
    AuthTokensResponseDto session = register(oldPhone, "Secret123!", "Mover");
    ageOtpCodes(oldPhone);

    // Step 1: declare new phone -> code to CURRENT phone.
    ResponseEntity<Void> start =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/start",
            authorized(Map.of("newPhone", newPhone), session.accessToken()),
            Void.class);
    assertThat(start.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(smsCountFor(newPhone)).isZero();

    // Step 2: prove current phone -> code to NEW phone.
    ResponseEntity<Void> verifyCurrent =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/verify-current",
            authorized(Map.of("code", lastCodeFor(oldPhone)), session.accessToken()),
            Void.class);
    assertThat(verifyCurrent.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(smsCountFor(newPhone)).isEqualTo(1);

    // Phone has NOT mutated yet (ES-02).
    String phoneInDb =
        jdbcTemplate.queryForObject("SELECT phone FROM users WHERE name = 'Mover'", String.class);
    assertThat(phoneInDb).isEqualTo(oldPhone);

    // Step 3: prove new phone -> phone updates.
    ResponseEntity<UserProfileDto> complete =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/complete",
            authorized(Map.of("code", lastCodeFor(newPhone)), session.accessToken()),
            UserProfileDto.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(complete.getBody()).isNotNull();
    assertThat(complete.getBody().phone()).isEqualTo(newPhone);

    assertThat(tryLogin(newPhone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.OK);
    assertThat(tryLogin(oldPhone, "Secret123!", ClientType.RIDER).getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  @DisplayName("phone change to a taken phone answers 409 and sends nothing")
  void shouldRejectPhoneChangeWhenNewPhoneTaken() {
    String phoneA = "+963911400005";
    String phoneB = "+963911400006";
    register(phoneB, "Secret123!", "Occupant");
    AuthTokensResponseDto session = register(phoneA, "Secret123!", "Wisher");
    int sentBefore = smsCountFor(phoneA);

    ResponseEntity<String> start =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/start",
            authorized(Map.of("newPhone", phoneB), session.accessToken()),
            String.class);

    assertThat(start.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(smsCountFor(phoneA)).isEqualTo(sentBefore);
  }

  @Test
  @DisplayName(
      "review V1 W12: a phone held by a deleted account is refused at start (409"
          + " phone_held_by_deleted_account), before any SMS")
  void shouldRejectPhoneChangeWhenNewPhoneHeldByDeletedAccount() {
    String deletedPhone = "+963911400013";
    AuthTokensResponseDto gone = register(deletedPhone, "Secret123!", "Leaver");
    ageOtpCodes(deletedPhone);
    String otp = requestTwoFactorCode(gone.accessToken(), deletedPhone);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/users/me",
                    HttpMethod.DELETE,
                    authorized(Map.of("otpCode", otp), gone.accessToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    String phone = "+963911400014";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Taker");
    int sentBefore = smsCountFor(phone);

    // Any typed form of the deleted account's number is the same number.
    ResponseEntity<JsonNode> start =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/start",
            authorized(Map.of("newPhone", "0911400013"), session.accessToken()),
            JsonNode.class);

    assertThat(start.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(start.getBody().path("code").asText()).isEqualTo("phone_held_by_deleted_account");
    assertThat(smsCountFor(phone)).isEqualTo(sentBefore);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM phone_change_sessions", Integer.class))
        .isZero();
  }

  @Test
  @DisplayName(
      "review V1 H3: 0933000111, +963933000111 and 963933000111 are one identity, stored E.164")
  void shouldTreatEveryPhoneFormAsOneIdentity() {
    // Registration started in the local form, verified in another: one number, one OTP.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/register/start", Map.of("phone", "0933000111"), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    ResponseEntity<RegisterVerifyResponseDto> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", "963933000111", "code", lastCodeFor("+963933000111")),
            RegisterVerifyResponseDto.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    ResponseEntity<AuthTokensResponseDto> complete =
        restTemplate.postForEntity(
            "/api/v1/auth/register/complete",
            Map.of(
                "registrationToken",
                verify.getBody().registrationToken(),
                "password",
                "Secret123!",
                "name",
                "Local Typist",
                "termsAccepted",
                true),
            AuthTokensResponseDto.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    AuthTokensResponseDto session = complete.getBody();
    assertThat(session.user().phone()).isEqualTo("+963933000111");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT phone FROM users WHERE user_id = ?", String.class, session.user().id()))
        .isEqualTo("+963933000111");

    // The other forms find the same account: registering again is refused, login works.
    for (String form : List.of("+963933000111", "963933000111", "0933 000 111")) {
      ResponseEntity<JsonNode> again =
          restTemplate.postForEntity(
              "/api/v1/auth/register/start", Map.of("phone", form), JsonNode.class);
      assertThat(again.getStatusCode()).as(form).isEqualTo(HttpStatus.CONFLICT);
      ResponseEntity<AuthTokensResponseDto> login = tryLogin(form, "Secret123!", ClientType.RIDER);
      assertThat(login.getStatusCode()).as(form).isEqualTo(HttpStatus.OK);
      assertThat(login.getBody().user().id()).isEqualTo(session.user().id());
    }
    // A foreign number must carry its + and code: a bare one is invalid, not a new identity.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/register/start", Map.of("phone", "447700900123"), String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(smsCountFor("447700900123")).isZero();
  }

  @Test
  @DisplayName("phone-change steps out of order answer 410")
  void shouldRejectPhoneChangeStepWhenOutOfOrder() {
    String phone = "+963911400007";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Skipper");

    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/complete",
            authorized(Map.of("code", "123456"), session.accessToken()),
            String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GONE);
  }

  @Test
  @DisplayName("phone-change state lives in the database: a flow another instance began completes")
  void shouldCompletePhoneChangeWhenStateWasWrittenElsewhere() {
    String oldPhone = "+963911400009";
    String newPhone = "+963911400010";
    AuthTokensResponseDto session = register(oldPhone, "Secret123!", "Roamer");
    ageOtpCodes(oldPhone);

    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/users/me/phone-change/start",
                    authorized(Map.of("newPhone", newPhone), session.accessToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    UUID userId =
        jdbcTemplate.queryForObject(
            "SELECT user_id FROM users WHERE phone = ?", UUID.class, oldPhone);
    assertThat(
            jdbcTemplate.queryForMap(
                "SELECT new_phone, stage FROM phone_change_sessions WHERE user_id = ?", userId))
        .containsEntry("new_phone", newPhone)
        .containsEntry("stage", "awaiting_current");

    // Step 2 as another API instance would have run it: only the database carries the stage.
    jdbcTemplate.update(
        "UPDATE phone_change_sessions SET stage = 'awaiting_new' WHERE user_id = ?", userId);
    otpService.issue(newPhone, OtpPurpose.TWO_FA, Language.EN);

    ResponseEntity<UserProfileDto> complete =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/complete",
            authorized(Map.of("code", lastCodeFor(newPhone)), session.accessToken()),
            UserProfileDto.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(complete.getBody()).isNotNull();
    assertThat(complete.getBody().phone()).isEqualTo(newPhone);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM phone_change_sessions WHERE user_id = ?",
                Integer.class,
                userId))
        .isZero();
  }

  @Test
  @DisplayName("an expired phone change answers 410 and its row is removed")
  void shouldRejectPhoneChangeStepWhenExpired() {
    String phone = "+963911400011";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Latecomer");
    ageOtpCodes(phone);
    restTemplate.postForEntity(
        "/api/v1/users/me/phone-change/start",
        authorized(Map.of("newPhone", "+963911400012"), session.accessToken()),
        Void.class);
    jdbcTemplate.update(
        "UPDATE phone_change_sessions SET expires_at = now() - interval '1 minute'");

    ResponseEntity<String> response =
        restTemplate.postForEntity(
            "/api/v1/users/me/phone-change/verify-current",
            authorized(Map.of("code", lastCodeFor(phone)), session.accessToken()),
            String.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.GONE);
    // The removal commits although the step answered 410.
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM phone_change_sessions", Integer.class))
        .isZero();
  }

  @Test
  @DisplayName("photo upload validates type, stores privately, and serves owner-only")
  void shouldServePhotoWhenUploaded() {
    String phone = "+963911400008";
    AuthTokensResponseDto session = register(phone, "Secret123!", "Shutter");

    // Unsupported type -> 400.
    assertThat(
            uploadPhoto(session.accessToken(), "notes.txt", MediaType.TEXT_PLAIN, String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.BAD_REQUEST);

    ResponseEntity<UserProfileDto> upload =
        uploadPhoto(session.accessToken(), "me.png", MediaType.IMAGE_PNG, UserProfileDto.class);
    assertThat(upload.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(upload.getBody()).isNotNull();
    assertThat(upload.getBody().photoUrl()).isEqualTo("/api/v1/users/me/photo");

    ResponseEntity<byte[]> photo =
        restTemplate.exchange(
            "/api/v1/users/me/photo",
            HttpMethod.GET,
            new HttpEntity<>(bearer(session.accessToken())),
            byte[].class);
    assertThat(photo.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(photo.getBody()).isEqualTo(new byte[] {1, 2, 3, 4});

    // Private: anonymous access is denied (NFR-S2).
    ResponseEntity<String> anonymous =
        restTemplate.getForEntity("/api/v1/users/me/photo", String.class);
    assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  private <T> ResponseEntity<T> uploadPhoto(
      String accessToken, String filename, MediaType contentType, Class<T> responseType) {
    HttpHeaders partHeaders = new HttpHeaders();
    partHeaders.setContentType(contentType);
    HttpEntity<ByteArrayResource> part =
        new HttpEntity<>(
            new ByteArrayResource(new byte[] {1, 2, 3, 4}) {
              @Override
              public String getFilename() {
                return filename;
              }
            },
            partHeaders);

    MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
    body.add("file", part);

    HttpHeaders headers = bearer(accessToken);
    headers.setContentType(MediaType.MULTIPART_FORM_DATA);
    return restTemplate.exchange(
        "/api/v1/users/me/photo", HttpMethod.PUT, new HttpEntity<>(body, headers), responseType);
  }
}
