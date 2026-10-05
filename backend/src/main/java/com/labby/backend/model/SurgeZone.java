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
 * An admin-drawn surge zone inside one region (PRC-02, UC-A-08). Threshold steps are ordered {@code
 * [{ratio, multiplier}, …]}; the multiplier cycle itself is M9. Override fields exist for the
 * UC-A-09 manual-override flow (also M9) and stay null until then.
 */
@Entity
@Table(name = "surge_zones")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class SurgeZone {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "surge_zone_id")
  private UUID id;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  @Column(name = "name", nullable = false, length = 100)
  private String name;

  @Column(name = "polygon", nullable = false, columnDefinition = "geometry(Polygon,4326)")
  private Polygon polygon;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "threshold_steps", nullable = false)
  private List<Map<String, Object>> thresholdSteps;

  @Column(name = "multiplier_cap")
  private BigDecimal multiplierCap;

  @Column(name = "override_multiplier")
  private BigDecimal overrideMultiplier;

  @Column(name = "override_set_by")
  private UUID overrideSetBy;

  @Column(name = "override_set_at")
  private Instant overrideSetAt;

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
    if (!(other instanceof SurgeZone that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
