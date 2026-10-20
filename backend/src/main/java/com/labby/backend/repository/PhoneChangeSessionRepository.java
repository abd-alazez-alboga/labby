package com.labby.backend.repository;

import com.labby.backend.model.PhoneChangeSession;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Phone changes in progress, one per account (ES-02, V32). */
public interface PhoneChangeSessionRepository extends JpaRepository<PhoneChangeSession, UUID> {

  /**
   * Starts or advances the account's phone change — a single atomic upsert on the account, so a new
   * start replaces whatever (live or expired) flow was there.
   *
   * @param userId the account
   * @param newPhone the phone being moved to
   * @param stage the stage wire value
   * @param expiresAt when the flow lapses
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO phone_change_sessions (user_id, new_phone, stage, expires_at)
          VALUES (:userId, :newPhone, :stage, :expiresAt)
          ON CONFLICT (user_id) DO UPDATE
            SET new_phone = EXCLUDED.new_phone, stage = EXCLUDED.stage,
                expires_at = EXCLUDED.expires_at
          """,
      nativeQuery = true)
  void upsert(
      @Param("userId") UUID userId,
      @Param("newPhone") String newPhone,
      @Param("stage") String stage,
      @Param("expiresAt") Instant expiresAt);

  @Modifying
  @Query("DELETE FROM PhoneChangeSession s WHERE s.userId = :userId")
  int deleteForUser(@Param("userId") UUID userId);
}
