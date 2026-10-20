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
 * A user's points (GRW-04/GAME-03, V24): {@code redeemable} spends down, {@code lifetime} only ever
 * grows (levels never decrease on redemption). Writers lock this row.
 */
@Entity
@Table(name = "points_accounts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class PointsAccount {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Builder.Default
  @Column(name = "redeemable", nullable = false)
  private long redeemable = 0;

  @Builder.Default
  @Column(name = "lifetime", nullable = false)
  private long lifetime = 0;

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

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof PointsAccount that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(userId);
  }
}
