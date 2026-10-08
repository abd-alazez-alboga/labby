package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * The stored final fare of a completed ride (RIDE-06, PRC-04): written once at completion, every
 * component kept so receipts and history render it without recomputing. The DB checks that the
 * total equals the components.
 */
@Entity
@Table(name = "fares")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Fare {

  @Id
  @Column(name = "ride_id")
  private UUID rideId;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @Column(name = "distance_m", nullable = false)
  private int distanceM;

  @Column(name = "duration_s", nullable = false)
  private int durationS;

  @Column(name = "base_fare", nullable = false)
  private BigDecimal baseFare;

  @Column(name = "distance_fare", nullable = false)
  private BigDecimal distanceFare;

  @Column(name = "time_fare", nullable = false)
  private BigDecimal timeFare;

  @Column(name = "surcharge_percent", nullable = false)
  private BigDecimal surchargePercent;

  @Column(name = "surcharge_amount", nullable = false)
  private BigDecimal surchargeAmount;

  @Column(name = "surge_multiplier", nullable = false)
  private BigDecimal surgeMultiplier;

  @Column(name = "surge_amount", nullable = false)
  private BigDecimal surgeAmount;

  @Column(name = "wait_fare", nullable = false)
  private BigDecimal waitFare;

  @Column(name = "pickup_fee", nullable = false)
  private BigDecimal pickupFee;

  @Column(name = "minimum_fare_adjustment", nullable = false)
  private BigDecimal minimumFareAdjustment;

  @Column(name = "discount", nullable = false)
  private BigDecimal discount;

  @Column(name = "total", nullable = false)
  private BigDecimal total;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof Fare that)) {
      return false;
    }
    return rideId != null && rideId.equals(that.rideId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(rideId);
  }
}
