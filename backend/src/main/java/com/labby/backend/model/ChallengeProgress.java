package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One participant's progress in one challenge (GAME-02, V24). The reward credit is exactly-once:
 * the linked points transaction is set once, after {@code completedAt}, and no credit serves two
 * rows (V24 unique). Writers lock this row.
 */
@Entity
@Table(name = "challenge_progress")
@IdClass(ChallengeProgress.Key.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ChallengeProgress {

  @Id
  @Column(name = "challenge_id")
  private UUID challengeId;

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Builder.Default
  @Column(name = "progress", nullable = false)
  private int progress = 0;

  @Column(name = "completed_at")
  private Instant completedAt;

  @Column(name = "points_transaction_id")
  private UUID pointsTransactionId;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @PrePersist
  void onCreate() {
    updatedAt = Objects.requireNonNullElse(updatedAt, Instant.now());
  }

  @PreUpdate
  void onUpdate() {
    updatedAt = Instant.now();
  }

  /** The composite primary key. */
  @NoArgsConstructor
  @AllArgsConstructor
  @EqualsAndHashCode
  public static class Key implements Serializable {
    private UUID challengeId;
    private UUID userId;
  }
}
