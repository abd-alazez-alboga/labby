package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.LoginFailure;
import com.labby.backend.repository.LoginFailureRepository;
import com.labby.backend.service.LoginThrottle;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Per phone+IP failed-login throttling (NFR-S3): the decision over the persisted counter. The
 * upsert's window arithmetic runs against PostgreSQL in RateLimitIntegrationTest.
 */
@ExtendWith(MockitoExtension.class)
class LoginThrottleTest {

  private static final String PHONE = "+963900000400";
  private static final String IP = "10.1.1.1";

  @Mock private LoginFailureRepository loginFailureRepository;

  private LoginThrottle throttle(int maxAttempts, long windowSeconds) {
    return new LoginThrottle(
        new AuthProperties("secret", 900, 1209600, maxAttempts, windowSeconds),
        loginFailureRepository);
  }

  private void stored(int failures, Instant windowStart) {
    when(loginFailureRepository.findByPhoneAndClientIp(PHONE, IP))
        .thenReturn(
            Optional.of(
                LoginFailure.builder()
                    .phone(PHONE)
                    .clientIp(IP)
                    .failures(failures)
                    .windowStart(windowStart)
                    .build()));
  }

  @Test
  @DisplayName("throttles once the failure limit is reached inside the window")
  void shouldThrottleWhenFailuresReachLimit() {
    stored(3, Instant.now().minusSeconds(60));

    assertThatThrownBy(() -> throttle(3, 900).check(PHONE, IP))
        .isInstanceOf(TooManyRequestsException.class);
  }

  @Test
  @DisplayName("below the limit, or with no counter, the attempt goes through")
  void shouldAllowWhenBelowLimit() {
    stored(2, Instant.now().minusSeconds(60));

    assertThatCode(() -> throttle(3, 900).check(PHONE, IP)).doesNotThrowAnyException();
    assertThatCode(() -> throttle(3, 900).check(PHONE, "10.9.9.9")).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("an expired window no longer throttles")
  void shouldAllowWhenWindowExpired() {
    stored(5, Instant.now().minusSeconds(901));

    assertThatCode(() -> throttle(1, 900).check(PHONE, IP)).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("a failure is one upsert whose window cutoff is now minus the window")
  void shouldUpsertWithWindowCutoffWhenFailureRecorded() {
    throttle(3, 900).recordFailure(PHONE, IP);

    ArgumentCaptor<Instant> now = ArgumentCaptor.forClass(Instant.class);
    ArgumentCaptor<Instant> cutoff = ArgumentCaptor.forClass(Instant.class);
    verify(loginFailureRepository)
        .recordFailure(eq(PHONE), eq(IP), now.capture(), cutoff.capture());
    assertThat(Duration.between(cutoff.getValue(), now.getValue())).hasSeconds(900);
  }

  @Test
  @DisplayName("a successful login deletes the pair's counter")
  void shouldDeleteCounterWhenReset() {
    throttle(2, 900).reset(PHONE, IP);

    verify(loginFailureRepository).deletePair(PHONE, IP);
  }
}
