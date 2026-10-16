package com.labby.backend.model;

import com.labby.backend.enums.SharedDepartureMode;
import com.labby.backend.enums.SharedDispatchTrigger;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * The shared extension of a ride of kind {@code shared} (RIDE-P1..5, scheduled-shared-v1.yaml).
 * {@code seatsTaken} caches the party sizes of the {@code joined} members; every writer locks the
 * RIDE row first and {@code ck_shared_rides_seats_taken} is the last-seat backstop.
 */
@Entity
@Table(name = "shared_rides")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class SharedRide {

  @Id
  @Column(name = "ride_id")
  private UUID rideId;

  @Column(name = "total_seats", nullable = false)
  private short totalSeats;

  @Column(name = "seats_taken", nullable = false)
  private short seatsTaken;

  @Column(name = "departure_mode", nullable = false, length = 10)
  private SharedDepartureMode departureMode;

  @Column(name = "departure_at")
  private Instant departureAt;

  @Column(name = "expires_at")
  private Instant expiresAt;

  @Column(name = "dispatch_trigger", length = 14)
  private SharedDispatchTrigger dispatchTrigger;

  @Column(name = "dispatched_at")
  private Instant dispatchedAt;

  @Column(name = "split_seats")
  private Short splitSeats;

  @Column(name = "per_seat_amount")
  private BigDecimal perSeatAmount;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Seats still free.
   *
   * @return total − taken
   */
  public int seatsLeft() {
    return totalSeats - seatsTaken;
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
    if (!(other instanceof SharedRide that)) {
      return false;
    }
    return rideId != null && rideId.equals(that.rideId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(rideId);
  }
}
