package com.labby.backend.model;

import com.labby.backend.enums.ApplicationStatus;
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

/** One stage change of a driver application, with its note (UC-D-03 history). */
@Entity
@Table(name = "driver_application_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverApplicationEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "driver_application_event_id")
  private UUID id;

  @Column(name = "driver_profile_id", nullable = false)
  private UUID driverProfileId;

  /** NULL for the first submission. */
  @Column(name = "from_status", length = 16)
  private ApplicationStatus fromStatus;

  @Column(name = "to_status", nullable = false, length = 16)
  private ApplicationStatus toStatus;

  @Column(name = "note", length = 1000)
  private String note;

  @Column(name = "actor_user_id", nullable = false)
  private UUID actorUserId;

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
    if (!(other instanceof DriverApplicationEvent that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
