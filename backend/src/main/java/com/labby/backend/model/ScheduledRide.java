package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
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
 * The scheduled extension of a ride of kind {@code scheduled} (RIDE-S1..4,
 * scheduled-shared-v1.yaml). The claim lives here until conversion; every writer locks the RIDE row
 * first. Reminder marks are per party and mean "handled" (sent, or skipped because the tier's
 * moment was already past at booking / claim); the driver's marks belong to the current claim.
 */
@Entity
@Table(name = "scheduled_rides")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ScheduledRide {

  @Id
  @Column(name = "ride_id")
  private UUID rideId;

  @Column(name = "scheduled_at", nullable = false)
  private Instant scheduledAt;

  @Column(name = "claimed_driver_user_id")
  private UUID claimedDriverUserId;

  @Column(name = "claimed_vehicle_id")
  private UUID claimedVehicleId;

  @Column(name = "claimed_at")
  private Instant claimedAt;

  @Column(name = "rider_reminder_first_at")
  private Instant riderReminderFirstAt;

  @Column(name = "rider_reminder_second_at")
  private Instant riderReminderSecondAt;

  @Column(name = "driver_reminder_first_at")
  private Instant driverReminderFirstAt;

  @Column(name = "driver_reminder_second_at")
  private Instant driverReminderSecondAt;

  @Column(name = "fallback_at")
  private Instant fallbackAt;

  @Column(name = "converted_at")
  private Instant convertedAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether a driver holds the claim.
   *
   * @return true while claimed
   */
  public boolean isClaimed() {
    return claimedDriverUserId != null;
  }

  /**
   * Whether the ride already left the scheduled phase (converted or fallen back).
   *
   * @return true once executed
   */
  public boolean isExecuted() {
    return fallbackAt != null || convertedAt != null;
  }

  /** Clears the claim and the driver's reminder marks (a release). */
  public void clearClaim() {
    claimedDriverUserId = null;
    claimedVehicleId = null;
    claimedAt = null;
    driverReminderFirstAt = null;
    driverReminderSecondAt = null;
  }

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
    if (!(other instanceof ScheduledRide that)) {
      return false;
    }
    return rideId != null && rideId.equals(that.rideId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(rideId);
  }
}
