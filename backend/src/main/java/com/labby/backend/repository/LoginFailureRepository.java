package com.labby.backend.repository;

import com.labby.backend.model.LoginFailure;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Failed-login counters per phone + client IP (NFR-S3, V32). */
public interface LoginFailureRepository extends JpaRepository<LoginFailure, UUID> {

  Optional<LoginFailure> findByPhoneAndClientIp(String phone, String clientIp);

  /**
   * Counts one failed attempt — a single atomic upsert on the pair: the first failure, or the first
   * after the window passed ({@code windowStart + window < now}), opens a new window at 1; any
   * other adds one to the current window.
   *
   * @param phone the login phone
   * @param clientIp the caller IP
   * @param now the attempt instant
   * @param windowStartCutoff {@code now − window}: a window that started before it has passed
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO login_failures (phone, client_ip, window_start, failures)
          VALUES (:phone, :clientIp, :now, 1)
          ON CONFLICT (phone, client_ip) DO UPDATE
            SET window_start = CASE WHEN login_failures.window_start < :windowStartCutoff
                                    THEN EXCLUDED.window_start
                                    ELSE login_failures.window_start END,
                failures = CASE WHEN login_failures.window_start < :windowStartCutoff
                                THEN 1
                                ELSE login_failures.failures + 1 END
          """,
      nativeQuery = true)
  void recordFailure(
      @Param("phone") String phone,
      @Param("clientIp") String clientIp,
      @Param("now") Instant now,
      @Param("windowStartCutoff") Instant windowStartCutoff);

  @Modifying
  @Query("DELETE FROM LoginFailure f WHERE f.phone = :phone AND f.clientIp = :clientIp")
  int deletePair(@Param("phone") String phone, @Param("clientIp") String clientIp);
}
