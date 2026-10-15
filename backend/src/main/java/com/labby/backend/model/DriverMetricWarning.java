package com.labby.backend.model;

import com.labby.backend.enums.DriverMetric;
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
 * A DRV-07 warning interval: raised when a driver's 30-day acceptance or cancellation crosses the
 * region's threshold (with the evaluation that raised it — "the triggering rule", UC-D-20), cleared
 * when the metric recovers. At most one ACTIVE warning per driver x metric (V17). Never suspends.
 */
@Entity
@Table(name = "driver_metric_warnings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverMetricWarning {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "driver_metric_warning_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "metric", nullable = false, length = 12)
  private DriverMetric metric;

  @Column(name = "value_percent", nullable = false)
  private BigDecimal valuePercent;

  @Column(name = "threshold_percent", nullable = false)
  private BigDecimal thresholdPercent;

  @Column(name = "window_days", nullable = false)
  private short windowDays;

  @Column(name = "sample_size", nullable = false)
  private int sampleSize;

  @Column(name = "raised_at", nullable = false)
  private Instant raisedAt;

  @Column(name = "cleared_at")
  private Instant clearedAt;

  @PrePersist
  void onCreate() {
    if (raisedAt == null) {
      raisedAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof DriverMetricWarning that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
