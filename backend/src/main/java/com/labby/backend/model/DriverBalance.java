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
 * A driver's running balance per currency (COM-03): a transactional cache of the {@code
 * driver_ledger} sum, updated with a pessimistic row lock in the SAME transaction as its ledger
 * entry. May be negative (cash commission debt), unlike wallets.
 */
@Entity
@Table(name = "driver_balances")
@IdClass(DriverBalance.Key.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverBalance {

  @Id
  @Column(name = "driver_user_id")
  private UUID driverUserId;

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
    if (!(other instanceof DriverBalance that)) {
      return false;
    }
    return driverUserId != null
        && driverUserId.equals(that.driverUserId)
        && currency != null
        && currency.equals(that.currency);
  }

  @Override
  public int hashCode() {
    return Objects.hash(driverUserId, currency);
  }

  /** The composite primary key (driver x currency). */
  @NoArgsConstructor
  @AllArgsConstructor
  @Getter
  @Setter
  public static class Key implements Serializable {

    private UUID driverUserId;
    private String currency;

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(driverUserId, that.driverUserId)
          && Objects.equals(currency, that.currency);
    }

    @Override
    public int hashCode() {
      return Objects.hash(driverUserId, currency);
    }
  }
}
