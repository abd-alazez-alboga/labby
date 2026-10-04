package com.labby.backend.unit.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.service.LoginThrottle;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Per phone+IP failed-login throttling (NFR-S3). */
class LoginThrottleTest {

  private static final String PHONE = "+963900000400";
  private static final String IP = "10.1.1.1";

  private LoginThrottle throttle(int maxAttempts, long windowSeconds) {
    return new LoginThrottle(
        new AuthProperties("secret", 900, 1209600, maxAttempts, windowSeconds));
  }

  @Test
  @DisplayName("throttles once the failure limit is reached inside the window")
  void shouldThrottleWhenFailuresReachLimit() {
    LoginThrottle throttle = throttle(3, 900);
    for (int failure = 0; failure < 3; failure++) {
      throttle.check(PHONE, IP);
      throttle.recordFailure(PHONE, IP);
    }

    assertThatThrownBy(() -> throttle.check(PHONE, IP))
        .isInstanceOf(TooManyRequestsException.class);
  }

  @Test
  @DisplayName("a successful login resets the counter")
  void shouldAllowWhenCounterReset() {
    LoginThrottle throttle = throttle(2, 900);
    throttle.recordFailure(PHONE, IP);
    throttle.recordFailure(PHONE, IP);
    throttle.reset(PHONE, IP);

    assertThatCode(() -> throttle.check(PHONE, IP)).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("counters are scoped per phone+IP pair")
  void shouldNotThrottleWhenDifferentIp() {
    LoginThrottle throttle = throttle(1, 900);
    throttle.recordFailure(PHONE, IP);

    assertThatThrownBy(() -> throttle.check(PHONE, IP))
        .isInstanceOf(TooManyRequestsException.class);
    assertThatCode(() -> throttle.check(PHONE, "10.9.9.9")).doesNotThrowAnyException();
    assertThatCode(() -> throttle.check("+963900000999", IP)).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("an expired window no longer throttles")
  void shouldAllowWhenWindowExpired() throws InterruptedException {
    LoginThrottle throttle = throttle(1, 0);
    throttle.recordFailure(PHONE, IP);
    Thread.sleep(5);

    assertThatCode(() -> throttle.check(PHONE, IP)).doesNotThrowAnyException();
  }
}
