package com.labby.backend.repository;

import com.labby.backend.enums.WalletTransactionType;
import com.labby.backend.model.WalletTransaction;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** The append-only wallet ledger (PAY-01, UC-R-17): INSERT only, never update or delete. */
public interface WalletTransactionRepository extends JpaRepository<WalletTransaction, UUID> {

  Page<WalletTransaction> findByUserIdOrderByCreatedAtDescIdDesc(UUID userId, Pageable pageable);

  Page<WalletTransaction> findByUserIdAndCurrencyOrderByCreatedAtDescIdDesc(
      UUID userId, String currency, Pageable pageable);

  List<WalletTransaction> findByRideId(UUID rideId);

  boolean existsByRideIdAndUserIdAndType(UUID rideId, UUID userId, WalletTransactionType type);
}
