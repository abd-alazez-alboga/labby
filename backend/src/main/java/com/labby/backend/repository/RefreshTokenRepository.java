package com.labby.backend.repository;

import com.labby.backend.model.RefreshToken;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Hashed, rotated refresh tokens (NFR-S1). */
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

  Optional<RefreshToken> findByTokenHash(String tokenHash);

  @Modifying
  @Query(
      "update RefreshToken t set t.revokedAt = :now"
          + " where t.userId = :userId and t.revokedAt is null")
  int revokeAllByUserId(@Param("userId") UUID userId, @Param("now") Instant now);

  @Modifying
  @Query(
      "update RefreshToken t set t.revokedAt = :now"
          + " where t.userId = :userId and t.revokedAt is null and t.id <> :exceptId")
  int revokeAllByUserIdExcept(
      @Param("userId") UUID userId, @Param("exceptId") UUID exceptId, @Param("now") Instant now);
}
