package com.labby.backend.repository;

import com.labby.backend.model.DriverBalance;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Per-currency driver balances (COM-03) — updated only through {@code DriverLedgerService}. */
public interface DriverBalanceRepository extends JpaRepository<DriverBalance, DriverBalance.Key> {

  /**
   * The balance row locked FOR UPDATE: serializes every ledger writer of one driver x currency so
   * the balance always equals its ledger sum.
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "SELECT b FROM DriverBalance b WHERE b.driverUserId = :driverUserId"
          + " AND b.currency = :currency")
  Optional<DriverBalance> findForUpdate(
      @Param("driverUserId") UUID driverUserId, @Param("currency") String currency);

  Optional<DriverBalance> findByDriverUserIdAndCurrency(UUID driverUserId, String currency);

  List<DriverBalance> findByDriverUserIdOrderByCurrencyAsc(UUID driverUserId);
}
