package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.locationtech.jts.geom.Point;

/**
 * A driver's latest position (TRK-01), overwritten by every newer sample. {@code receivedAt} drives
 * stale-stream detection (TRK-04); ride traces (TRK-03) arrive with M7.
 */
@Entity
@Table(name = "driver_locations")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverLocation {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Column(name = "position", nullable = false, columnDefinition = "geometry(Point,4326)")
  private Point position;

  @Column(name = "heading_deg")
  private Float headingDeg;

  @Column(name = "speed_mps")
  private Float speedMps;

  @Column(name = "accuracy_m")
  private Float accuracyM;

  /** Device fix time. */
  @Column(name = "recorded_at", nullable = false)
  private Instant recordedAt;

  /** Server arrival time (stale detection). */
  @Column(name = "received_at", nullable = false)
  private Instant receivedAt;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof DriverLocation that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(userId);
  }
}
