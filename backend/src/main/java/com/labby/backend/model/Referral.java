package com.labby.backend.model;

import com.labby.backend.enums.ReferralStatus;
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

/**
 * A captured referral (GRW-03, V24): unique per referee account AND per phone number ever (owner
 * ruling 2026-10-18 — rows are never deleted, so a deleted + reactivated account never retriggers a
 * reward). Rewarded on the referee's first completed ride, both sides.
 */
@Entity
@Table(name = "referrals")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Referral {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "referral_id")
  private UUID id;

  @Column(name = "referrer_user_id", nullable = false)
  private UUID referrerUserId;

  @Column(name = "referee_user_id", nullable = false)
  private UUID refereeUserId;

  @Column(name = "referee_phone", nullable = false, length = 20)
  private String refereePhone;

  @Builder.Default
  @Column(name = "status", nullable = false, length = 8)
  private ReferralStatus status = ReferralStatus.PENDING;

  @Column(name = "rewarded_ride_id")
  private UUID rewardedRideId;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "rewarded_at")
  private Instant rewardedAt;

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof Referral that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
