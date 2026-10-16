package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One weekly availability window of a driver (DRV-05, UC-D-05): ISO weekday + wall-clock range read
 * in the time zone of the ride's region. Same semantics as surcharge windows — start inclusive, end
 * exclusive, end before start spans midnight, start = end is the whole day. Gates the claim board.
 */
@Entity
@Table(name = "availability_windows")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class AvailabilityWindow {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "availability_window_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "day_of_week", nullable = false)
  private short dayOfWeek;

  @Column(name = "starts_at", nullable = false)
  private LocalTime startsAt;

  @Column(name = "ends_at", nullable = false)
  private LocalTime endsAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof AvailabilityWindow that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
