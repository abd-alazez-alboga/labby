package com.labby.backend.repository;

import com.labby.backend.enums.ClientType;
import com.labby.backend.model.DeviceToken;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** FCM registration tokens (ES-03). */
public interface DeviceTokenRepository extends JpaRepository<DeviceToken, UUID> {

  Optional<DeviceToken> findByToken(String token);

  List<DeviceToken> findByUserId(UUID userId);

  /**
   * The account's tokens registered by the given clients (a notification's audience), but only
   * while the account holds at least one live session — a token must never outlive the sessions of
   * its account (defense in depth behind {@link #deleteByUserId} on every revoke-all path).
   *
   * @param userId the account
   * @param apps the audience's clients
   * @param now the liveness instant (a session is live when not revoked and not expired)
   * @return the pushable tokens, empty when the account has no live session
   */
  @Query(
      "SELECT d FROM DeviceToken d WHERE d.userId = :userId AND d.app IN :apps"
          + " AND EXISTS (SELECT 1 FROM RefreshToken r WHERE r.userId = d.userId"
          + " AND r.revokedAt IS NULL AND r.expiresAt > :now)")
  List<DeviceToken> findPushable(
      @Param("userId") UUID userId,
      @Param("apps") Collection<ClientType> apps,
      @Param("now") Instant now);

  /**
   * Registers a token for the account, or moves it to the account when another one held it (one
   * account per device at a time) — a single atomic upsert on the unique token.
   *
   * @param userId the caller
   * @param token the FCM token
   * @param platform the platform wire value
   * @param app the client wire value
   * @param now registration time
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO device_tokens (user_id, token, platform, app, created_at, last_seen_at)
          VALUES (:userId, :token, :platform, :app, :now, :now)
          ON CONFLICT (token) DO UPDATE
            SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app = EXCLUDED.app,
                last_seen_at = EXCLUDED.last_seen_at
          """,
      nativeQuery = true)
  void upsert(
      @Param("userId") UUID userId,
      @Param("token") String token,
      @Param("platform") String platform,
      @Param("app") String app,
      @Param("now") Instant now);

  @Modifying
  @Query("DELETE FROM DeviceToken d WHERE d.token = :token AND d.userId = :userId")
  int deleteOwned(@Param("token") String token, @Param("userId") UUID userId);

  @Modifying
  @Query("DELETE FROM DeviceToken d WHERE d.userId = :userId")
  int deleteByUserId(@Param("userId") UUID userId);

  @Modifying
  @Query("DELETE FROM DeviceToken d WHERE d.token IN :tokens")
  int deleteByTokens(@Param("tokens") Collection<String> tokens);
}
