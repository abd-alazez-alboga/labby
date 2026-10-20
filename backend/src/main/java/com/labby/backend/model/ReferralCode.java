package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

/** A user's one shareable referral code (GRW-03, V24), created lazily on first read. */
@Entity
@Table(name = "referral_codes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ReferralCode {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Column(name = "code", nullable = false, length = 12)
  private String code;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    createdAt = Objects.requireNonNullElse(createdAt, Instant.now());
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof ReferralCode that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(userId);
  }
}
