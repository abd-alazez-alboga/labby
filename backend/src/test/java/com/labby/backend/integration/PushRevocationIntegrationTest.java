package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.PasswordResetVerifyResponseDto;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.service.NotificationDispatchService;
import com.labby.backend.service.NotificationService;
import com.labby.backend.service.PushSender;
import com.labby.backend.service.PushSender.PushResult;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Review M6 H1 (NFR-S3): push tokens never outlive the sessions of their account. Every path that
 * revokes all of an account's (other) sessions deletes all of its device tokens, so a queued
 * notification is recorded {@code no_device} with its center row intact; and the dispatcher pushes
 * only to accounts holding at least one live session (defense in depth — a single-session logout
 * still relies on the client's {@code DELETE /devices/{token}}). {@link PushSender} is mocked at
 * the boundary.
 */
class PushRevocationIntegrationTest extends AbstractOnboardingIntegrationTest {

  @MockitoBean private PushSender pushSender;

  @Autowired private NotificationDispatchService notificationDispatchService;
  @Autowired private NotificationService notificationService;

  @BeforeEach
  void pushSucceeds() {
    Mockito.reset(pushSender);
    when(pushSender.send(anyList(), any()))
        .thenAnswer(
            invocation -> new PushResult(invocation.<List<?>>getArgument(0).size(), Set.of()));
  }

  private void registerDevice(String accessToken, String token) {
    HttpHeaders headers = bearer(accessToken);
    headers.setContentType(MediaType.APPLICATION_JSON);
    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/devices",
                    HttpMethod.PUT,
                    new HttpEntity<>(
                        Map.of("token", token, "platform", "android", "app", "driver"), headers),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
  }

  private int deviceTokens(UUID userId) {
    return jdbcTemplate.queryForObject(
        "SELECT count(*) FROM device_tokens WHERE user_id = ?", Integer.class, userId);
  }

  /** Queues a driver notification, dispatches, and asserts it reached the center but no device. */
  private void assertQueuedNotificationIsNotPushed(UUID userId) {
    notificationService.queue(userId, NotificationEvent.DRIVER_REINSTATED);
    notificationDispatchService.dispatchPending();

    verify(pushSender, never()).send(anyList(), any());
    Map<String, Object> row =
        jdbcTemplate.queryForMap(
            "SELECT push_status, title_en FROM notifications WHERE user_id = ?", userId);
    assertThat(row.get("push_status")).isEqualTo("no_device");
    assertThat(row.get("title_en")).isEqualTo("Account active again");
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM notification_outbox WHERE user_id = ?"
                    + " AND delivered_at IS NOT NULL",
                Integer.class,
                userId))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("refresh-token reuse (theft) revokes every session and deletes every push token")
  void shouldDeleteTokensOnRefreshTokenReuse() {
    AuthTokensResponseDto victim = register("+963938000001", PASSWORD, "Victim");
    UUID userId = victim.user().id();
    registerDevice(victim.accessToken(), "fcm-victim");
    // The thief rotates the stolen refresh token and registers its own device.
    ResponseEntity<AuthTokensResponseDto> stolen =
        restTemplate.postForEntity(
            "/api/v1/auth/refresh",
            Map.of("refreshToken", victim.refreshToken()),
            AuthTokensResponseDto.class);
    assertThat(stolen.getStatusCode()).isEqualTo(HttpStatus.OK);
    registerDevice(stolen.getBody().accessToken(), "fcm-thief");
    assertThat(deviceTokens(userId)).isEqualTo(2);

    // The victim's client replays the already-rotated token: reuse detected.
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/refresh",
                    Map.of("refreshToken", victim.refreshToken()),
                    String.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.UNAUTHORIZED);

    assertThat(deviceTokens(userId)).isZero();
    assertQueuedNotificationIsNotPushed(userId);
  }

  @Test
  @DisplayName("password reset deletes every push token")
  void shouldDeleteTokensOnPasswordReset() {
    String phone = "+963938000002";
    AuthTokensResponseDto session = register(phone, PASSWORD, "Forgetful");
    UUID userId = session.user().id();
    registerDevice(session.accessToken(), "fcm-reset");

    restTemplate.postForEntity(
        "/api/v1/auth/password-reset/start", Map.of("phone", phone), Void.class);
    ResponseEntity<PasswordResetVerifyResponseDto> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/password-reset/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            PasswordResetVerifyResponseDto.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/password-reset/complete",
                    Map.of(
                        "resetToken", verify.getBody().resetToken(), "newPassword", "NewSecret1!"),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    assertThat(deviceTokens(userId)).isZero();
    assertQueuedNotificationIsNotPushed(userId);
  }

  @Test
  @DisplayName("password change (signs out the other devices) deletes every push token")
  void shouldDeleteTokensOnPasswordChange() {
    String phone = "+963938000003";
    AuthTokensResponseDto session = register(phone, PASSWORD, "Changer");
    UUID userId = session.user().id();
    registerDevice(session.accessToken(), "fcm-change");
    ageOtpCodes(phone);
    String otp = requestTwoFactorCode(session.accessToken(), phone);

    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/users/me/password",
                    HttpMethod.PUT,
                    authorized(
                        Map.of(
                            "currentPassword", PASSWORD,
                            "otpCode", otp,
                            "newPassword", "NewSecret1!"),
                        session.accessToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    assertThat(deviceTokens(userId)).isZero();
    // The device that stayed signed in registers its token again and keeps receiving pushes.
    registerDevice(session.accessToken(), "fcm-change");
    notificationService.queue(userId, NotificationEvent.DRIVER_REINSTATED);
    notificationDispatchService.dispatchPending();
    verify(pushSender).send(Mockito.eq(List.of("fcm-change")), any());
  }

  @Test
  @DisplayName("account deletion deletes every push token; the center row is still recorded")
  void shouldDeleteTokensOnAccountDeletion() {
    String phone = "+963938000004";
    AuthTokensResponseDto session = register(phone, PASSWORD, "Leaving");
    UUID userId = session.user().id();
    registerDevice(session.accessToken(), "fcm-deleted");
    ageOtpCodes(phone);
    String otp = requestTwoFactorCode(session.accessToken(), phone);

    assertThat(
            restTemplate
                .exchange(
                    "/api/v1/users/me",
                    HttpMethod.DELETE,
                    authorized(Map.of("otpCode", otp), session.accessToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    assertThat(deviceTokens(userId)).isZero();
    assertQueuedNotificationIsNotPushed(userId);
  }

  @Test
  @DisplayName("an account with no live session (logged out or expired) gets no push")
  void shouldNotPushWithoutALiveSession() {
    // Logged out without the client's DELETE /devices: the token row remains, the push does not.
    AuthTokensResponseDto loggedOut = register("+963938000005", PASSWORD, "Logged Out");
    registerDevice(loggedOut.accessToken(), "fcm-logged-out");
    assertThat(
            restTemplate
                .postForEntity(
                    "/api/v1/auth/logout",
                    Map.of("refreshToken", loggedOut.refreshToken()),
                    Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(deviceTokens(loggedOut.user().id())).isEqualTo(1);
    assertQueuedNotificationIsNotPushed(loggedOut.user().id());

    // Every session expired (never revoked): no push either.
    AuthTokensResponseDto expired = register("+963938000006", PASSWORD, "Expired");
    registerDevice(expired.accessToken(), "fcm-expired");
    jdbcTemplate.update(
        "UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = ?",
        expired.user().id());
    assertQueuedNotificationIsNotPushed(expired.user().id());
  }
}
