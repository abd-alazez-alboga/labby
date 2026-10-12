package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.io.Serializable;
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
 * One user's wallet balance in one currency (PAY-01): a transactional cache of the {@code
 * wallet_transactions} sum, updated with a pessimistic row lock in the SAME transaction as its
 * ledger entry, never negative (DB CHECK). Created on first credit.
 */
@Entity
@Table(name = "wallet_balances")
@IdClass(WalletBalance.Key.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class WalletBalance {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Id
  @Column(name = "currency", length = 3)
  private String currency;

  @Builder.Default
  @Column(name = "balance", nullable = false)
  private BigDecimal balance = BigDecimal.ZERO;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  void onCreate() {
    updatedAt = Instant.now();
  }

  @PreUpdate
  void onUpdate() {
    updatedAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof WalletBalance that)) {
      return false;
    }
    return userId != null
        && userId.equals(that.userId)
        && currency != null
        && currency.equals(that.currency);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userId, currency);
  }

  /** The composite primary key (user x currency). */
  @NoArgsConstructor
  @AllArgsConstructor
  @Getter
  @Setter
  public static class Key implements Serializable {

    private UUID userId;
    private String currency;

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(userId, that.userId) && Objects.equals(currency, that.currency);
    }

    @Override
    public int hashCode() {
      return Objects.hash(userId, currency);
    }
  }
}
