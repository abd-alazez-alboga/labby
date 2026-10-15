package com.labby.backend.model;

import com.labby.backend.enums.RideParty;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * The RATE-02 exposed view of one user x role's lifetime average: the only average riders and
 * drivers ever see, rewritten once a day by the snapshot job so a single rating never visibly moves
 * it right after a ride (timing side-channel mitigation, owner ruling 2026-10-15).
 */
@Entity
@Table(name = "rating_snapshots")
@IdClass(RatingSnapshot.Key.class)
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class RatingSnapshot {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  /**
   * The role's wire value ({@code rider} / {@code driver}) — a plain string because JPA applies no
   * attribute converter to id columns; {@link #party()} gives the enum.
   */
  @Id
  @Column(name = "role", length = 6)
  private String role;

  @Column(name = "avg_score", nullable = false)
  private BigDecimal avgScore;

  @Column(name = "rating_count", nullable = false)
  private int ratingCount;

  @Column(name = "computed_at", nullable = false)
  private Instant computedAt;

  /** The composite primary key (user x role). */
  @Getter
  @NoArgsConstructor
  @AllArgsConstructor
  public static class Key implements Serializable {

    private static final long serialVersionUID = 1L;

    private UUID userId;
    private String role;

    /**
     * The key of a user x role.
     *
     * @param userId the user
     * @param role the role
     */
    public Key(UUID userId, RideParty role) {
      this(userId, role.getValue());
    }

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof Key that)) {
        return false;
      }
      return Objects.equals(userId, that.userId) && Objects.equals(role, that.role);
    }

    @Override
    public int hashCode() {
      return Objects.hash(userId, role);
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof RatingSnapshot that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId) && Objects.equals(role, that.role);
  }

  /**
   * The role as the enum.
   *
   * @return rider or driver
   */
  public RideParty party() {
    return RideParty.fromValue(role);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userId, role);
  }
}
