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

/**
 * One RATE-01 rating: a ride's rider rates its driver role or vice versa, once per side, immutable
 * (V17 trigger) — hence no setters. The rated party is denormalized from the ride so the per-role
 * aggregates are one indexed scan. Never exposed individually to riders or drivers (RATE-02): they
 * see only the ratings they gave.
 */
@Entity
@Table(name = "ratings")
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Rating {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "rating_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "rater_user_id", nullable = false)
  private UUID raterUserId;

  @Column(name = "rater_role", nullable = false, length = 6)
  private RideParty raterRole;

  @Column(name = "rated_user_id", nullable = false)
  private UUID ratedUserId;

  @Column(name = "rated_role", nullable = false, length = 6)
  private RideParty ratedRole;

  @Column(name = "score", nullable = false)
  private short score;

  @Column(name = "comment", length = 1000)
  private String comment;

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
    if (!(other instanceof Rating that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
