package com.labby.backend.repository;

import com.labby.backend.model.Referral;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Captured referrals (GRW-03): unique per referee account and per phone ever (V24). */
public interface ReferralRepository extends JpaRepository<Referral, UUID> {

  Optional<Referral> findByRefereeUserId(UUID refereeUserId);

  /** The reward lock: the referee's completion pays out exactly once under it. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT r FROM Referral r WHERE r.refereeUserId = :refereeUserId")
  Optional<Referral> lockByRefereeUserId(@Param("refereeUserId") UUID refereeUserId);

  List<Referral> findByReferrerUserIdOrderByCreatedAtDesc(UUID referrerUserId);

  boolean existsByRefereePhone(String refereePhone);
}
