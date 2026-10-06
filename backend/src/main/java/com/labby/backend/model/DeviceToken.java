package com.labby.backend.model;

import com.labby.backend.enums.ClientType;
import com.labby.backend.enums.DevicePlatform;
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

/** An FCM registration token (ES-03); one account per token at a time. */
@Entity
@Table(name = "device_tokens")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class DeviceToken {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "device_token_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "token", nullable = false)
  private String token;

  @Column(name = "platform", nullable = false, length = 8)
  private DevicePlatform platform;

  /** The client the token belongs to (rider / driver / admin app). */
  @Column(name = "app", nullable = false, length = 8)
  private ClientType app;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "last_seen_at", nullable = false)
  private Instant lastSeenAt;

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    createdAt = now;
    if (lastSeenAt == null) {
      lastSeenAt = now;
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof DeviceToken that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
