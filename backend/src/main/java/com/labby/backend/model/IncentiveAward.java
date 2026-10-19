package com.labby.backend.model;

import com.labby.backend.enums.IncentiveKind;
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
 * One paid DRV-08 incentive (incentives-v1, V31): unique per driver x region x week x kind — the
 * weekly job's exactly-once key — and linked to the {@code bonus} ledger entry it posted.
 */
@Entity
@Table(name = "incentive_awards")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class IncentiveAward {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "incentive_award_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  /** The region-local Monday of the evaluated week. */
  @Column(name = "week_start", nullable = false)
  private LocalDate weekStart;

  @Column(name = "kind", nullable = false)
  private IncentiveKind kind;

  /** Week trips (weekly trips / rating) or peak trips (peak hours). */
  @Column(name = "trips", nullable = false)
  private int trips;

  /** The tier's trip count (weekly trips only). */
  @Column(name = "threshold")
  private Integer threshold;

  /** The week's average rating, 2 decimals (rating only). */
  @Column(name = "avg_rating")
  private BigDecimal avgRating;

  @Column(name = "amount", nullable = false)
  private BigDecimal amount;

  @Column(name = "currency", nullable = false)
  private String currency;

  @Column(name = "driver_ledger_id", nullable = false)
  private UUID driverLedgerId;

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
    if (!(other instanceof IncentiveAward that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
