package com.labby.backend.service;

import com.labby.backend.config.AuthProperties;
import com.labby.backend.exception.TooManyRequestsException;
import com.labby.backend.model.LoginFailure;
import com.labby.backend.repository.LoginFailureRepository;
import java.time.Instant;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Fixed-window failed-login counter per phone+IP (NFR-S3), persisted in {@code login_failures}
 * (V32) so every instance and a restart see the same counters (NFR-P4). Successful login deletes
 * the counter; exceeding the limit inside the window answers 429; a window that has passed no
 * longer throttles and the next failure restarts it. One upsert per failed attempt, one read per
 * attempt.
 */
@Component
public class LoginThrottle {

  private final LoginFailureRepository loginFailureRepository;
  private final int maxAttempts;
  private final long windowSeconds;

  public LoginThrottle(
      AuthProperties authProperties, LoginFailureRepository loginFailureRepository) {
    this.loginFailureRepository = loginFailureRepository;
    this.maxAttempts = authProperties.loginMaxAttempts();
    this.windowSeconds = authProperties.loginWindowSeconds();
  }

  /**
   * Rejects the attempt when the phone+IP pair has exhausted its failures in the current window.
   * Read-only: an expired row is simply ignored (the next failure restarts it).
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   * @throws TooManyRequestsException when throttled
   */
  public void check(String phone, String clientIp) {
    LoginFailure window =
        loginFailureRepository.findByPhoneAndClientIp(phone, clientIp).orElse(null);
    if (window != null && !isExpired(window) && window.getFailures() >= maxAttempts) {
      throw new TooManyRequestsException("Too many failed login attempts; try again later");
    }
  }

  /**
   * Records one failed attempt in the caller's transaction, which therefore must commit on the 401
   * it is about to answer ({@code AuthServiceImpl#login} declares {@code noRollbackFor}). Not a
   * separate transaction on purpose: a brute-force burst would then hold two pooled connections per
   * attempt and could starve the pool.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   */
  @Transactional
  public void recordFailure(String phone, String clientIp) {
    Instant now = Instant.now();
    loginFailureRepository.recordFailure(phone, clientIp, now, now.minusSeconds(windowSeconds));
  }

  /**
   * Clears the counter after a successful login.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   */
  @Transactional
  public void reset(String phone, String clientIp) {
    loginFailureRepository.deletePair(phone, clientIp);
  }

  private boolean isExpired(LoginFailure window) {
    return window.getWindowStart().plusSeconds(windowSeconds).isBefore(Instant.now());
  }
}
