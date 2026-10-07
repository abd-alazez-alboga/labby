package com.labby.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A notification queued behind the notification seam until M6 delivers it (center + push). {@code
 * event} is the template key, {@code params} its arguments.
 */
@Entity
@Table(name = "notification_outbox")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class NotificationOutboxEntry {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "notification_outbox_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "event", nullable = false, length = 64)
  private String event;

  @Builder.Default
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "params", nullable = false)
  private Map<String, Object> params = new HashMap<>();

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  /**
   * When a dispatcher claimed the entry for delivery (set before its push); a claim older than the
   * dispatcher's timeout is stale and may be taken over (NFR-P4: several instances).
   */
  @Column(name = "claimed_at")
  private Instant claimedAt;

  @Column(name = "delivered_at")
  private Instant deliveredAt;

  @PrePersist
  void onCreate() {
    createdAt = Instant.now();
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof NotificationOutboxEntry that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
