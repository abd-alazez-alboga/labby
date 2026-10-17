package com.labby.backend.repository;

import com.labby.backend.model.ReferralCode;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Shareable referral codes (GRW-03), one per user, created lazily. */
public interface ReferralCodeRepository extends JpaRepository<ReferralCode, UUID> {

  Optional<ReferralCode> findByCode(String code);

  boolean existsByCode(String code);
}
