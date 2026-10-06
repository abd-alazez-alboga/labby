package com.labby.backend.model;

import com.labby.backend.enums.ApplicationStatus;
import com.labby.backend.enums.ReviewStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
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
 * One per account (USR-01): the driver application and, once approved, the driver record.
 * Reapplication after rejection reuses the row (UC-D-03 A2). {@code version} guards against two
 * reviewers deciding at once.
 */
@Entity
@Table(name = "driver_profiles")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverProfile {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "driver_profile_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Builder.Default
  @Column(name = "application_status", nullable = false, length = 16)
  private ApplicationStatus applicationStatus = ApplicationStatus.SUBMITTED;

  @Column(name = "submitted_at", nullable = false)
  private Instant submittedAt;

  @Column(name = "decided_at")
  private Instant decidedAt;

  @Column(name = "decided_by")
  private UUID decidedBy;

  /** Set exactly while the application is rejected (V6 CHECK). */
  @Column(name = "rejection_reason", length = 1000)
  private String rejectionReason;

  /** Review state of the "personal details" item (account name + profile photo). */
  @Builder.Default
  @Column(name = "personal_review_status", nullable = false, length = 20)
  private ReviewStatus personalReviewStatus = ReviewStatus.PENDING;

  @Column(name = "personal_review_note", length = 1000)
  private String personalReviewNote;

  /** Online/offline (DRV-05); only an approved driver may be online (V7 CHECK). */
  @Builder.Default
  @Column(name = "is_online", nullable = false)
  private boolean online = false;

  @Column(name = "online_changed_at")
  private Instant onlineChangedAt;

  @Version
  @Column(name = "version", nullable = false)
  private long version;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    createdAt = now;
    updatedAt = now;
    if (submittedAt == null) {
      submittedAt = now;
    }
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
    if (!(other instanceof DriverProfile that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
