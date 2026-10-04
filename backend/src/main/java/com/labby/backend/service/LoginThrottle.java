package com.labby.backend.service;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.exception.TooManyRequestsException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Simple in-memory fixed-window failed-login counter per phone+IP (NFR-S3). Successful login clears
 * the counter; exceeding the limit inside the window answers 429. Sized for V1's single instance —
 * a shared store can replace it without touching callers.
 */
@Component
public class LoginThrottle {

  private record Window(Instant start, int failures) {}

  private final Map<String, Window> windows = new ConcurrentHashMap<>();
  private final int maxAttempts;
  private final long windowSeconds;

  public LoginThrottle(AuthProperties authProperties) {
    this.maxAttempts = authProperties.loginMaxAttempts();
    this.windowSeconds = authProperties.loginWindowSeconds();
  }

  /**
   * Rejects the attempt when the phone+IP pair has exhausted its failures in the current window.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   * @throws TooManyRequestsException when throttled
   */
  public void check(String phone, String clientIp) {
    Window window = windows.get(key(phone, clientIp));
    if (window != null && !isExpired(window) && window.failures() >= maxAttempts) {
      throw new TooManyRequestsException("Too many failed login attempts; try again later");
    }
  }

  /**
   * Records one failed attempt.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   */
  public void recordFailure(String phone, String clientIp) {
    windows.compute(
        key(phone, clientIp),
        (key, window) ->
            window == null || isExpired(window)
                ? new Window(Instant.now(), 1)
                : new Window(window.start(), window.failures() + 1));
  }

  /**
   * Clears the counter after a successful login.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   */
  public void reset(String phone, String clientIp) {
    windows.remove(key(phone, clientIp));
  }

  private boolean isExpired(Window window) {
    return window.start().plusSeconds(windowSeconds).isBefore(Instant.now());
  }

  private static String key(String phone, String clientIp) {
    return phone + "|" + clientIp;
  }
}
