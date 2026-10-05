package com.labby.backend.model;

import com.labby.backend.enums.DocumentType;
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
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One of the four driver documents (DRV-01), reviewed on its own (DRV-02). Registration and
 * insurance carry their vehicle; ID and licence do not (V6 CHECK). A renewal (UC-D-19) is a new
 * pending row beside the still-approved one, which becomes superseded on the renewal's approval.
 */
@Entity
@Table(name = "documents")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DriverDocument {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "document_id")
  private UUID id;

  @Column(name = "driver_user_id", nullable = false)
  private UUID driverUserId;

  @Column(name = "vehicle_id")
  private UUID vehicleId;

  @Column(name = "type", nullable = false, length = 24)
  private DocumentType type;

  @Column(name = "number", nullable = false, length = 50)
  private String number;

  @Column(name = "expires_on", nullable = false)
  private LocalDate expiresOn;

  @Column(name = "stored_file_id", nullable = false)
  private UUID storedFileId;

  @Builder.Default
  @Column(name = "review_status", nullable = false, length = 20)
  private ReviewStatus reviewStatus = ReviewStatus.PENDING;

  @Column(name = "review_note", length = 1000)
  private String reviewNote;

  @Column(name = "reviewed_by")
  private UUID reviewedBy;

  @Column(name = "reviewed_at")
  private Instant reviewedAt;

  @Column(name = "reminder_30_sent_at")
  private Instant reminder30SentAt;

  @Column(name = "reminder_7_sent_at")
  private Instant reminder7SentAt;

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
    if (!(other instanceof DriverDocument that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
