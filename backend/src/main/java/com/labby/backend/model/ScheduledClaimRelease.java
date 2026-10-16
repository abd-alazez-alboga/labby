package com.labby.backend.model;

import com.labby.backend.enums.ClaimReleaseReason;
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

/**
 * A released scheduled-ride claim (UC-D-12 E1) — append-only (V19 trigger). Feeds the driver's
 * cancellation metric (DRV-06/07) except the system's {@code account_suspended} releases.
 */
@Entity
@Table(name = "scheduled_claim_releases")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ScheduledClaimRelease {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "scheduled_claim_release_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false)
  private UUID rideId;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "claimed_at", nullable = false)
  private Instant claimedAt;

  @Column(name = "released_at", nullable = false)
  private Instant releasedAt;

  @Column(name = "reason", nullable = false, length = 24)
  private ClaimReleaseReason reason;

  @Column(name = "note", length = 500)
  private String note;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof ScheduledClaimRelease that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
