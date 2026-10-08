package com.labby.backend.model;

import com.labby.backend.enums.TracePhase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
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
 * One GPS sample of a ride (TRK-03, kept forever): the metered fare's source of truth (phase {@code
 * in_ride}), receipt route maps and dispute review. Appended, never updated.
 */
@Entity
@Table(name = "ride_traces")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RideTrace {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "ride_trace_id")
  private Long id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "phase", nullable = false, length = 10)
  private TracePhase phase;

  @Column(name = "position", nullable = false, columnDefinition = "geometry(Point,4326)")
  private Point position;

  @Column(name = "accuracy_m")
  private Float accuracyM;

  @Column(name = "speed_mps")
  private Float speedMps;

  @Column(name = "heading_deg")
  private Float headingDeg;

  @Column(name = "recorded_at", nullable = false)
  private Instant recordedAt;

  @Column(name = "received_at", nullable = false)
  private Instant receivedAt;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof RideTrace that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
