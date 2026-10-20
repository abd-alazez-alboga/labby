package com.labby.backend.model;

import com.labby.backend.enums.ChallengeGoalType;
import com.labby.backend.enums.RideParty;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
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
 * An admin-created challenge (GAME-02, V24), per region and role. An early end sets {@code
 * endedAt}: progress stops, completions already credited stand.
 */
@Entity
@Table(name = "challenges")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Challenge {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "challenge_id")
  private UUID id;

  @Column(name = "region_id", nullable = false)
  private UUID regionId;

  @Column(name = "role", nullable = false, length = 6)
  private RideParty role;

  @Column(name = "title_en", nullable = false, length = 120)
  private String titleEn;

  @Column(name = "title_ar", nullable = false, length = 120)
  private String titleAr;

  @Column(name = "goal_type", nullable = false, length = 20)
  private ChallengeGoalType goalType;

  @Column(name = "goal_target", nullable = false)
  private int goalTarget;

  @Column(name = "reward_points", nullable = false)
  private long rewardPoints;

  @Column(name = "starts_at", nullable = false)
  private Instant startsAt;

  @Column(name = "ends_at", nullable = false)
  private Instant endsAt;

  @Column(name = "ended_at")
  private Instant endedAt;

  @Column(name = "created_by", nullable = false)
  private UUID createdBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  /**
   * Whether the challenge counts events at a moment: inside the window and not ended early.
   *
   * @param at the event moment
   * @return true while running
   */
  public boolean runningAt(Instant at) {
    return endedAt == null && !at.isBefore(startsAt) && at.isBefore(endsAt);
  }

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
    updatedAt = Objects.requireNonNullElse(updatedAt, createdAt);
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
    if (!(other instanceof Challenge that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
