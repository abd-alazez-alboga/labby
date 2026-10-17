package com.labby.backend.repository;

import com.labby.backend.model.PointsAccount;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Points balances (GRW-04). Writers go through {@link #lockOrCreate}. */
public interface PointsAccountRepository extends JpaRepository<PointsAccount, UUID> {

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT a FROM PointsAccount a WHERE a.userId = :userId")
  Optional<PointsAccount> findForUpdate(@Param("userId") UUID userId);

  /** Insert-if-absent so a racing first accrual never hits a primary-key clash. */
  @Modifying
  @Query(
      value =
          "INSERT INTO points_accounts (user_id) VALUES (:userId) ON CONFLICT (user_id) DO"
              + " NOTHING",
      nativeQuery = true)
  void insertIfAbsent(@Param("userId") UUID userId);

  /** Insert-if-absent, then lock. */
  default PointsAccount lockOrCreate(UUID userId) {
    insertIfAbsent(userId);
    return findForUpdate(userId).orElseThrow();
  }
}
