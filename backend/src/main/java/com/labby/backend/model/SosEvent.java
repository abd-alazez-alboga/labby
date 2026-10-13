package com.labby.backend.model;

import com.labby.backend.enums.RideParty;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
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
 * One SOS event (SAFE-01/02). The facts (ride, who, where, when) are PERMANENT — the V15 trigger
 * blocks DELETE and any mutation of the core fields; only the handling fields (acknowledgedBy /
 * acknowledgedAt / note) may change. {@code triggeredAt} is the device moment clamped to server
 * time; an open (unacknowledged) event is the red pin on the live ops map.
 */
@Entity
@Table(name = "sos_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class SosEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "sos_event_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "triggered_by_user_id", nullable = false)
  private UUID triggeredByUserId;

  @Column(name = "triggered_by_role", nullable = false, length = 6)
  private RideParty triggeredByRole;

  @Column(name = "location", nullable = false, columnDefinition = "geometry(Point,4326)")
  private Point location;

  @Column(name = "triggered_at", nullable = false)
  private Instant triggeredAt;

  @Column(name = "acknowledged_by")
  private UUID acknowledgedBy;

  @Column(name = "acknowledged_at")
  private Instant acknowledgedAt;

  @Column(name = "note", length = 2000)
  private String note;

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
    if (!(other instanceof SosEvent that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
