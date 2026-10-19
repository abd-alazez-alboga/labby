package com.labby.backend.repository;

import com.labby.backend.model.ReferralCode;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Shareable referral codes (GRW-03), one per user, created lazily. */
public interface ReferralCodeRepository extends JpaRepository<ReferralCode, UUID> {

  Optional<ReferralCode> findByCode(String code);

  boolean existsByCode(String code);

  /**
   * Creates the user's code unless one exists or the random code collides, without aborting the
   * caller's transaction (M13 review W2).
   *
   * @return 1 when inserted, 0 on either conflict
   */
  @Modifying
  @Query(
      value =
          "INSERT INTO referral_codes (user_id, code) VALUES (:userId, :code) ON CONFLICT DO"
              + " NOTHING",
      nativeQuery = true)
  int insertIfAbsent(@Param("userId") UUID userId, @Param("code") String code);
}
