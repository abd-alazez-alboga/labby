package com.labby.backend.model;

import com.labby.backend.enums.FeedbackCategory;
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
 * One feedback / suggestion entry (FDBK-01, UC-S-22; V26): not ride-bound, in a fixed category,
 * recording which app sent it ({@code submittedAs}, the admin filter). Immutable; admins tag it.
 */
@Entity
@Table(name = "feedback")
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Feedback {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "feedback_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "submitted_as", nullable = false, length = 6)
  private RideParty submittedAs;

  @Column(name = "category", nullable = false, length = 16)
  private FeedbackCategory category;

  @Column(name = "body", nullable = false, length = 2000)
  private String body;

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
    if (!(other instanceof Feedback that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
