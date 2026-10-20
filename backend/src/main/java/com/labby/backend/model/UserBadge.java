package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
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
 * One awarded badge (GAME-01, V24): the composite key makes awarding exactly-once. The code is a
 * plain string (JPA forbids converters on id attributes) holding a {@code BadgeCode} value.
 */
@Entity
@Table(name = "user_badges")
@IdClass(UserBadge.Key.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class UserBadge {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Id
  @Column(name = "badge_code", length = 32)
  private String badgeCode;

  @Column(name = "awarded_at", nullable = false)
  private Instant awardedAt;

  @PrePersist
  void onCreate() {
    awardedAt = Objects.requireNonNullElse(awardedAt, Instant.now());
  }

  /** The composite primary key. */
  @NoArgsConstructor
  @AllArgsConstructor
  @EqualsAndHashCode
  public static class Key implements Serializable {
    private UUID userId;
    private String badgeCode;
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof UserBadge that)) {
      return false;
    }
    return userId != null
        && userId.equals(that.userId)
        && badgeCode != null
        && badgeCode.equals(that.badgeCode);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userId, badgeCode);
  }
}
