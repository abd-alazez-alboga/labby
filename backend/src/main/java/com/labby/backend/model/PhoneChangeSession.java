package com.labby.backend.model;

import com.labby.backend.enums.PhoneChangeStage;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
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
 * An account's phone change in progress (ES-02, V32): one row per account, written by each step
 * through {@code PhoneChangeSessionRepository#upsert}. Persisted, not held in memory, so the flow
 * survives a restart or a second instance (NFR-P4).
 */
@Entity
@Table(name = "phone_change_sessions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class PhoneChangeSession {

  @Id
  @Column(name = "user_id")
  private UUID userId;

  @Column(name = "new_phone", nullable = false, length = 20)
  private String newPhone;

  @Column(name = "stage", nullable = false, length = 16)
  private PhoneChangeStage stage;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
  private Instant createdAt;

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof PhoneChangeSession that)) {
      return false;
    }
    return userId != null && userId.equals(that.userId);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(userId);
  }
}
