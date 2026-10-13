package com.labby.backend.model;

import com.labby.backend.enums.ChatMessageKind;
import com.labby.backend.enums.RideParty;
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
 * One chat message (CHAT-02). Text messages carry a body, quick replies a catalog code (V15 shape
 * check). {@code clientMsgId} is the sender-generated dedup key ({@code uq_chat_messages_dedup}): a
 * resend after a reconnect returns this row, never a duplicate. Messages persist forever — the
 * window only gates writes (CHAT-03).
 */
@Entity
@Table(name = "chat_messages")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class ChatMessage {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "chat_message_id")
  private UUID id;

  @Column(name = "thread_id", nullable = false)
  private UUID threadId;

  @Column(name = "sender_user_id", nullable = false)
  private UUID senderUserId;

  @Column(name = "sender_role", nullable = false, length = 6)
  private RideParty senderRole;

  @Column(name = "kind", nullable = false, length = 11)
  private ChatMessageKind kind;

  @Column(name = "body", length = 1000)
  private String body;

  @Column(name = "quick_reply_code", length = 40)
  private String quickReplyCode;

  @Column(name = "client_msg_id", nullable = false)
  private UUID clientMsgId;

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
    if (!(other instanceof ChatMessage that)) {
      return false;
    }
    return id != null && id.equals(that.id);
  }

  @Override
  public int hashCode() {
    return Objects.hashCode(id);
  }
}
