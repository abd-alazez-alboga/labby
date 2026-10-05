package com.labby.backend.model;

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
 * A region's bookable service type with its pricing (PRC-01, UC-A-07). Disabled types stop
 * appearing in booking but are never deleted — existing rides keep referencing them.
 */
@Entity
@Table(name = "service_types")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ServiceType {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "service_type_id")
  private UUID id;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  @Column(name = "name_en", nullable = false, length = 50)
  private String nameEn;

  @Column(name = "name_ar", nullable = false, length = 50)
  private String nameAr;

  @Column(name = "base_fare", nullable = false)
  private BigDecimal baseFare;

  @Column(name = "per_km_rate", nullable = false)
  private BigDecimal perKmRate;

  @Column(name = "per_min_rate", nullable = false)
  private BigDecimal perMinRate;

  @Column(name = "minimum_fare", nullable = false)
  private BigDecimal minimumFare;

  @Builder.Default
  @Column(name = "enabled", nullable = false)
  private boolean enabled = true;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @Column(name = "created_by")
  private UUID createdBy;

  @Column(name = "updated_by")
  private UUID updatedBy;

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    createdAt = now;
    updatedAt = now;
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
    if (!(other instanceof ServiceType that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
