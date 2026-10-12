package com.labby.backend.model;

import com.labby.backend.enums.RiderDueStatus;
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
 * A carried rider charge (owner ruling (a)): a cancellation fee the wallet could not cover (and
 * every fee on a cash-method ride), collected in full on the rider's NEXT completed ride. A
 * workflow row, not a ledger — the money truth lands in {@code wallet_transactions} / {@code
 * driver_ledger} at collection.
 */
@Entity
@Table(name = "rider_dues")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RiderDue {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "rider_due_id")
  private UUID id;

  @Column(name = "rider_user_id", nullable = false)
  private UUID riderUserId;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Builder.Default
  @Column(name = "type", nullable = false, length = 20)
  private String type = "cancellation_fee";

  /** The cancelled ride the fee belongs to. */
  @Column(name = "source_ride_id", nullable = false)
  private UUID sourceRideId;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 10)
  private RiderDueStatus status = RiderDueStatus.PENDING;

  @Column(name = "collected_ride_id")
  private UUID collectedRideId;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "collected_at")
  private Instant collectedAt;

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
    if (!(other instanceof RiderDue that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
