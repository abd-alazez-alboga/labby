package com.labby.backend.model;

import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketSide;
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

/**
 * One entry of a ticket's history (SUP-02 "status/history in-app", V26): every state, priority,
 * assignment and case change with its actor; the thread view merges these with the messages by
 * time. System rows (the reminder) have no actor user.
 */
@Entity
@Table(name = "ticket_events")
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class TicketEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "ticket_event_id")
  private UUID id;

  @Column(name = "support_ticket_id", nullable = false)
  private UUID ticketId;

  @Column(name = "type", nullable = false, length = 20)
  private TicketEventType type;

  @Column(name = "actor_side", nullable = false, length = 7)
  private TicketSide actorSide;

  @Column(name = "actor_user_id")
  private UUID actorUserId;

  @Column(name = "from_value", length = 40)
  private String fromValue;

  @Column(name = "to_value", length = 40)
  private String toValue;

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
    if (!(other instanceof TicketEvent that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
