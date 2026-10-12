package com.labby.backend.repository;

import com.labby.backend.model.WalletBalance;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Per-currency wallet balances (PAY-01) — updated only through {@code WalletService}. */
public interface WalletBalanceRepository extends JpaRepository<WalletBalance, WalletBalance.Key> {

  /**
   * The balance row locked FOR UPDATE: serializes every wallet writer of one user x currency so the
   * balance always equals its ledger sum.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT b FROM WalletBalance b WHERE b.userId = :userId AND b.currency = :currency")
  Optional<WalletBalance> findForUpdate(
      @Param("userId") UUID userId, @Param("currency") String currency);

  List<WalletBalance> findByUserIdOrderByCurrencyAsc(UUID userId);
}
