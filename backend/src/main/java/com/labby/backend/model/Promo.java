package com.labby.backend.model;

import com.labby.backend.enums.PromoType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
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
 * A promo code (GRW-01/02, V24). Codes are stored uppercase and globally unique; a fixed-amount
 * promo is region-bound (its amount is in that region's currency). Caps are counted over {@code
 * promo_redemptions} under this row's lock.
 */
@Entity
@Table(name = "promos")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Promo {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "promo_id")
  private UUID id;

  @Column(name = "code", nullable = false, length = 20)
  private String code;

  @Column(name = "region_id")
  private UUID regionId;

  @Column(name = "service_type_id")
  private UUID serviceTypeId;

  @Column(name = "type", nullable = false, length = 7)
  private PromoType type;

  @Column(name = "value", nullable = false)
  private BigDecimal value;

  @Column(name = "max_discount")
  private BigDecimal maxDiscount;

  @Column(name = "starts_at", nullable = false)
  private Instant startsAt;

  @Column(name = "ends_at", nullable = false)
  private Instant endsAt;

  @Builder.Default
  @Column(name = "per_user_limit", nullable = false)
  private int perUserLimit = 1;

  @Column(name = "total_cap")
  private Integer totalCap;

  @Builder.Default
  @Column(name = "first_ride_only", nullable = false)
  private boolean firstRideOnly = false;

  @Builder.Default
  @Column(name = "active", nullable = false)
  private boolean active = true;

  @Column(name = "created_by", nullable = false)
  private UUID createdBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
    updatedAt = Objects.requireNonNullElse(updatedAt, createdAt);
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
    if (!(other instanceof Promo that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
