package com.labby.backend.model;

import com.labby.backend.enums.WalletTransactionType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One typed, signed wallet ledger entry (PAY-01, UC-R-17). APPEND-ONLY: the V12 trigger blocks
 * every UPDATE and DELETE, so this entity is insert-only from JPA too — corrections are new
 * entries, never edits. {@code balanceAfter} snapshots the per-currency balance after this entry.
 */
@Entity
@Table(name = "wallet_transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class WalletTransaction {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "wallet_transaction_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  /** Signed: credits positive, debits negative (V12 sign CHECK per type). */
  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Column(name = "type", nullable = false, length = 20)
  private WalletTransactionType type;

  @Column(name = "ride_id")
  private UUID rideId;

  /** The acting admin on grants/refunds (PAY-03), null otherwise. */
  @Column(name = "created_by")
  private UUID createdBy;

  @Column(name = "reason", length = 500)
  private String reason;

  @Column(name = "balance_after", nullable = false)
  private BigDecimal balanceAfter;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof WalletTransaction that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
