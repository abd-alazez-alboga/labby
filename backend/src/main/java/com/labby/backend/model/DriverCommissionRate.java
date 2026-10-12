package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The commission rate applied during {@code weekStart}'s week (COM-02): Monday start in the
 * region's time zone, computed from the PREVIOUS week's completed trips in that region. A missing
 * row means the region's base tier applies. Unique per driver x region x week.
 */
@Entity
@Table(name = "driver_commission_rates")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverCommissionRate {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "driver_commission_rate_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  @Column(name = "week_start", nullable = false)
  private LocalDate weekStart;

  @Column(name = "percent", nullable = false)
  private BigDecimal percent;

  /** The previous week's completed trips that set this rate. */
  @Column(name = "weekly_trips", nullable = false)
  private int weeklyTrips;

  @Column(name = "computed_at", nullable = false)
  private Instant computedAt;

  @PrePersist
  void onCreate() {
    if (computedAt == null) {
      computedAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof DriverCommissionRate that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
