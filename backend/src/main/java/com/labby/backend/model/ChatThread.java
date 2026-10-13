package com.labby.backend.model;

import com.labby.backend.enums.ChatWindowState;
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
 * One chat thread per ride (CHAT-01), created lazily at acceptance. The window state is DERIVED
 * from {@code closedAt} / {@code reopenedUntil} ({@link #windowState}), never stored; {@code
 * closedAt} is stamped terminal + 24 h when the ride ends. The per-party read markers back the
 * unread counts (CHAT-02).
 */
@Entity
@Table(name = "chat_threads")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ChatThread {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "chat_thread_id")
  private UUID id;

  @Column(name = "ride_id", nullable = false, unique = true)
  private UUID rideId;

  @Column(name = "opened_at", nullable = false)
  private Instant openedAt;

  /** Terminal moment + 24 h; null while the ride is live. */
  @Column(name = "closed_at")
  private Instant closedAt;

  /** The M14 lost-item hook: a future value reopens a closed window. */
  @Column(name = "reopened_until")
  private Instant reopenedUntil;

  @Column(name = "rider_last_read_message_id")
  private UUID riderLastReadMessageId;

  @Column(name = "driver_last_read_message_id")
  private UUID driverLastReadMessageId;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  /**
   * The derived window state (comms-v1.yaml CHAT-01 table).
   *
   * @param now the moment
   * @return open until {@code closedAt}, reopened while {@code reopenedUntil} is in the future,
   *     read-only after
   */
  public ChatWindowState windowState(Instant now) {
    if (closedAt == null || now.isBefore(closedAt)) {
      return ChatWindowState.OPEN;
    }
    if (reopenedUntil != null && now.isBefore(reopenedUntil)) {
      return ChatWindowState.REOPENED;
    }
    return ChatWindowState.READ_ONLY;
  }

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
    if (!(other instanceof ChatThread that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
