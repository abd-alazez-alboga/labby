package com.labby.backend.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.labby.backend.dto.AuthTokensResponseDto;
import com.labby.backend.dto.RegisterVerifyResponseDto;
import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.RegistrationMode;
import com.labby.backend.service.SmsSender;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Base for auth/account integration tests. {@code SmsSender} is stubbed at the boundary with
 * {@code @MockitoBean} — the single allowed stubbing point (ES-01: no runtime bypass exists) — and
 * every sent message is captured so tests can read the OTP exactly like a phone would.
 */
public abstract class AbstractAuthIntegrationTest extends AbstractIntegrationTest {

  private static final Pattern CODE_PATTERN = Pattern.compile("(\\d{6})");

  @Autowired protected TestRestTemplate restTemplate;
  @Autowired protected JdbcTemplate jdbcTemplate;
  @MockitoBean protected SmsSender smsSender;

  private final Map<String, List<String>> smsByPhone = new ConcurrentHashMap<>();

  @DynamicPropertySource
  static void storageProperties(DynamicPropertyRegistry registry) {
    registry.add(
        "labby.storage.dir",
        () -> {
          try {
            return Files.createTempDirectory("labby-test-uploads").toString();
          } catch (IOException ex) {
            throw new UncheckedIOException(ex);
          }
        });
  }

  @BeforeEach
  void captureSms() {
    smsByPhone.clear();
    Mockito.reset(smsSender);
    Mockito.doAnswer(
            invocation -> {
              smsByPhone
                  .computeIfAbsent(invocation.getArgument(0), key -> new ArrayList<>())
                  .add(invocation.getArgument(1));
              return null;
            })
        .when(smsSender)
        .send(Mockito.anyString(), Mockito.anyString());
  }

  @AfterEach
  void cleanDatabase() {
    // audit_log is append-only (V4 trigger blocks DELETE) and references users; TRUNCATE
    // bypasses row-level triggers, so the shared test DB can still be reset between tests.
    jdbcTemplate.execute("TRUNCATE audit_log");
    // The M8 money ledgers are append-only too (V12 triggers); one TRUNCATE handles their
    // cross-references (driver_ledger -> settlements / rider_dues). The money rows reference
    // rides and users, so they go before both.
    jdbcTemplate.execute("TRUNCATE wallet_transactions, driver_ledger, settlements");
    jdbcTemplate.update("DELETE FROM rider_dues");
    jdbcTemplate.update("DELETE FROM driver_commission_rates");
    jdbcTemplate.update("DELETE FROM wallet_balances");
    jdbcTemplate.update("DELETE FROM driver_balances");
    // M10 sos_events are permanent by trigger; TRUNCATE bypasses it like the ledgers above. The
    // comms rows reference rides and users, so they go before both.
    jdbcTemplate.execute("TRUNCATE sos_events");
    // Threads and messages reference each other (read markers), so they truncate together.
    jdbcTemplate.execute("TRUNCATE chat_messages, chat_threads");
    jdbcTemplate.update("DELETE FROM trip_share_links");
    // M7 ride rows reference users, vehicles, regions and service types: they go first.
    jdbcTemplate.update("DELETE FROM fares");
    jdbcTemplate.update("DELETE FROM ride_traces");
    jdbcTemplate.update("DELETE FROM ride_offers");
    jdbcTemplate.update("DELETE FROM rides");
    jdbcTemplate.update("DELETE FROM saved_locations");
    jdbcTemplate.update("DELETE FROM rider_preferences");
    jdbcTemplate.update("DELETE FROM notifications");
    jdbcTemplate.update("DELETE FROM notification_outbox");
    jdbcTemplate.update("DELETE FROM notification_preferences");
    jdbcTemplate.update("DELETE FROM device_tokens");
    jdbcTemplate.update("DELETE FROM driver_locations");
    jdbcTemplate.update("DELETE FROM refresh_tokens");
    jdbcTemplate.update("DELETE FROM otp_codes");
    jdbcTemplate.update("DELETE FROM role_assignments");
    jdbcTemplate.update("DELETE FROM users");
  }

  /** Returns the 6-digit code from the LAST SMS sent to the phone. */
  protected String lastCodeFor(String phone) {
    List<String> messages = smsByPhone.get(phone);
    assertThat(messages).as("an SMS was sent to %s", phone).isNotEmpty();
    Matcher matcher = CODE_PATTERN.matcher(messages.get(messages.size() - 1));
    assertThat(matcher.find()).as("SMS contains a 6-digit code").isTrue();
    return matcher.group(1);
  }

  protected int smsCountFor(String phone) {
    return smsByPhone.getOrDefault(phone, List.of()).size();
  }

  /** Backdates the phone's OTP rows so resend cooldown does not interfere with the next step. */
  protected void ageOtpCodes(String phone) {
    jdbcTemplate.update(
        "UPDATE otp_codes SET created_at = created_at - interval '10 minutes' WHERE phone = ?",
        phone);
  }

  /** Full register flow; returns the issued session. */
  protected AuthTokensResponseDto register(String phone, String password, String name) {
    assertThat(
            restTemplate
                .postForEntity("/api/v1/auth/register/start", Map.of("phone", phone), Void.class)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    ResponseEntity<RegisterVerifyResponseDto> verify =
        restTemplate.postForEntity(
            "/api/v1/auth/register/verify",
            Map.of("phone", phone, "code", lastCodeFor(phone)),
            RegisterVerifyResponseDto.class);
    assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(verify.getBody()).isNotNull();
    assertThat(verify.getBody().mode()).isEqualTo(RegistrationMode.NEW);

    ResponseEntity<AuthTokensResponseDto> complete =
        restTemplate.postForEntity(
            "/api/v1/auth/register/complete",
            Map.of(
                "registrationToken",
                verify.getBody().registrationToken(),
                "password",
                password,
                "name",
                name,
                "termsAccepted",
                true),
            AuthTokensResponseDto.class);
    assertThat(complete.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    assertThat(complete.getBody()).isNotNull();
    return complete.getBody();
  }

  protected ResponseEntity<AuthTokensResponseDto> tryLogin(
      String phone, String password, ClientType client) {
    return restTemplate.postForEntity(
        "/api/v1/auth/login",
        Map.of("phone", phone, "password", password, "client", client.getValue()),
        AuthTokensResponseDto.class);
  }

  protected AuthTokensResponseDto login(String phone, String password, ClientType client) {
    ResponseEntity<AuthTokensResponseDto> response = tryLogin(phone, password, client);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).isNotNull();
    return response.getBody();
  }

  protected HttpHeaders bearer(String accessToken) {
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth(accessToken);
    return headers;
  }

  protected <T> HttpEntity<T> authorized(T body, String accessToken) {
    return new HttpEntity<>(body, bearer(accessToken));
  }

  /** Requests a 2FA OTP for the authenticated user and returns the code sent to the phone. */
  protected String requestTwoFactorCode(String accessToken, String phone) {
    ResponseEntity<Void> response =
        restTemplate.postForEntity(
            "/api/v1/users/me/2fa/request",
            new HttpEntity<>(null, bearer(accessToken)),
            Void.class);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    return lastCodeFor(phone);
  }
}
