package com.labby.backend.model;

import com.labby.backend.enums.NotificationAudience;
import com.labby.backend.enums.NotificationCategory;
import com.labby.backend.enums.PushStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
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
 * A notification-center entry (NTF-03): server-stored, rendered in both languages at creation so a
 * language switch re-renders instantly. One row per outbox row (the dispatcher is idempotent).
 */
@Entity
@Table(name = "notifications")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class Notification {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "notification_id")
  private UUID id;

  @Column(name = "user_id", nullable = false)
  private UUID userId;

  @Column(name = "audience", nullable = false, length = 8)
  private NotificationAudience audience;

  @Column(name = "category", nullable = false, length = 16)
  private NotificationCategory category;

  @Column(name = "event", nullable = false, length = 64)
  private String event;

  @Column(name = "title_en", nullable = false, length = 200)
  private String titleEn;

  @Column(name = "body_en", nullable = false, length = 1000)
  private String bodyEn;

  @Column(name = "title_ar", nullable = false, length = 200)
  private String titleAr;

  @Column(name = "body_ar", nullable = false, length = 1000)
  private String bodyAr;

  /** Deep-link screen id from the realtime-v1.yaml catalog; null = no link. */
  @Column(name = "link_screen", length = 64)
  private String linkScreen;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "link_params")
  private Map<String, String> linkParams;

  @Column(name = "read_at")
  private Instant readAt;

  @Builder.Default
  @Column(name = "push_status", nullable = false, length = 12)
  private PushStatus pushStatus = PushStatus.PENDING;

  @Column(name = "pushed_at")
  private Instant pushedAt;

  @Column(name = "notification_outbox_id")
  private UUID notificationOutboxId;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    if (createdAt == null) {
      createdAt = Instant.now();
    }
  }

  @Override
  public boolean equals(Object other) {
    if (this == other) {
      return true;
    }
    if (!(other instanceof Notification that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
