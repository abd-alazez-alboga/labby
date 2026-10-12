package com.labby.backend.model;

import com.labby.backend.enums.DriverLedgerType;
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
 * One typed, signed driver ledger entry (COM-01, UC-D-15). APPEND-ONLY: the V12 trigger blocks
 * every UPDATE and DELETE, so this entity is insert-only from JPA too. Ride money entries carry
 * their ride; fare entries ({@code ride_earning} / {@code commission_due}) carry the full
 * itemization (fare, rate, commission); settlement entries are 1:1 with their settlements row.
 */
@Entity
@Table(name = "driver_ledger")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverLedgerEntry {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "driver_ledger_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  /** Signed: credits positive, debits negative (V12 sign CHECK per type). */
  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Column(name = "type", nullable = false, length = 20)
  private DriverLedgerType type;

  @Column(name = "ride_id")
  private UUID rideId;

  @Column(name = "settlement_id")
  private UUID settlementId;

  @Column(name = "rider_due_id")
  private UUID riderDueId;

  @Column(name = "fare_amount")
  private BigDecimal fareAmount;

  @Column(name = "commission_rate")
  private BigDecimal commissionRate;

  @Column(name = "commission_amount")
  private BigDecimal commissionAmount;

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
    if (!(other instanceof DriverLedgerEntry that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
