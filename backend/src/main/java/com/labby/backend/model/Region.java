package com.labby.backend.model;

import com.labby.backend.enums.RegionState;
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
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.locationtech.jts.geom.Polygon;

/**
 * A region with its full config bundle (ADM-01, SD-01). Drafts may be incomplete (UC-A-05 E1); the
 * structured bundle parts (commission tiers, incentives, suspension thresholds) are JSONB whose
 * shapes are defined by the regions-v1.yaml contract. Boundary is SRID 4326 (GeoJSON lng/lat at the
 * API edge).
 */
@Entity
@Table(name = "regions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Region {

  /** The launch market's zone, used when an admin sets none (V10 default). */
  public static final String DEFAULT_TIME_ZONE = "Asia/Damascus";

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "region_id")
  private UUID id;

  @Column(name = "name", nullable = false, unique = true, length = 100)
  private String name;

  @Column(name = "boundary", columnDefinition = "geometry(Polygon,4326)")
  private Polygon boundary;

  @Column(name = "currency", length = 3)
  private String currency;

  @Column(name = "emergency_number", length = 20)
  private String emergencyNumber;

  /** IANA zone the region's surcharge windows are evaluated in (M7; default Asia/Damascus). */
  @Builder.Default
  @Column(name = "time_zone", nullable = false, length = 64)
  private String timeZone = DEFAULT_TIME_ZONE;

  @Builder.Default
  @Column(name = "state", nullable = false, length = 10)
  private RegionState state = RegionState.DRAFT;

  @Column(name = "cancellation_grace_min")
  private Integer cancellationGraceMin;

  @Column(name = "cancellation_fee")
  private BigDecimal cancellationFee;

  @Column(name = "wait_grace_min")
  private Integer waitGraceMin;

  @Column(name = "wait_per_min_rate")
  private BigDecimal waitPerMinRate;

  @Column(name = "pickup_fee_threshold_km")
  private BigDecimal pickupFeeThresholdKm;

  @Column(name = "pickup_fee_per_km")
  private BigDecimal pickupFeePerKm;

  @Column(name = "surge_cap")
  private BigDecimal surgeCap;

  /** COM-03 floor (M8): never positive; NULL means the SRS default (−50). */
  @Column(name = "driver_balance_floor")
  private BigDecimal driverBalanceFloor;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "commission_tiers")
  private List<Map<String, Object>> commissionTiers;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "incentive_values")
  private Map<String, Object> incentiveValues;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "suspension_thresholds")
  private Map<String, Object> suspensionThresholds;

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
    if (!(other instanceof Region that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
