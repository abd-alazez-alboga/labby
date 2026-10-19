package com.labby.backend.model;

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
 * One message of a ticket's user <-> support thread (SUP-02, V26). Messages persist forever; the
 * ticket's status gates writes (closed = read-only), never the rows.
 */
@Entity
@Table(name = "ticket_messages")
@Getter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class TicketMessage {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "ticket_message_id")
  private UUID id;

  @Column(name = "support_ticket_id", nullable = false)
  private UUID ticketId;

  @Column(name = "sender_user_id", nullable = false)
  private UUID senderUserId;

  @Column(name = "sender_side", nullable = false, length = 7)
  private TicketSide senderSide;

  @Column(name = "body", nullable = false, length = 2000)
  private String body;

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
    if (!(other instanceof TicketMessage that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
