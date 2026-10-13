package com.labby.backend.repository;

import com.labby.backend.model.ChatMessage;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Chat messages (CHAT-02/03). History pages walk (created_at, id) backwards, backfill forwards. */
public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

  /** The dedup lookup ({@code uq_chat_messages_dedup}): a resend finds its stored row here. */
  Optional<ChatMessage> findByThreadIdAndSenderUserIdAndClientMsgId(
      UUID threadId, UUID senderUserId, UUID clientMsgId);

  Optional<ChatMessage> findByIdAndThreadId(UUID id, UUID threadId);

  /**
   * Inserts the message unless its (thread, sender, clientMsgId) already exists — the WS resend
   * race-safe half of the dedup: two concurrent sends of the same message store exactly one row and
   * both answer with it, never an error.
   *
   * @return 1 when inserted, 0 when the dedup key already existed
   */
  @Modifying
  @Query(
      value =
          """
          INSERT INTO chat_messages (chat_message_id, thread_id, sender_user_id, sender_role,
                                     kind, body, quick_reply_code, client_msg_id, created_at)
          VALUES (:id, :threadId, :senderUserId, :senderRole, :kind, :body, :quickReplyCode,
                  :clientMsgId, :createdAt)
          ON CONFLICT ON CONSTRAINT uq_chat_messages_dedup DO NOTHING
          """,
      nativeQuery = true)
  int insertIfAbsent(
      @Param("id") UUID id,
      @Param("threadId") UUID threadId,
      @Param("senderUserId") UUID senderUserId,
      @Param("senderRole") String senderRole,
      @Param("kind") String kind,
      @Param("body") String body,
      @Param("quickReplyCode") String quickReplyCode,
      @Param("clientMsgId") UUID clientMsgId,
      @Param("createdAt") Instant createdAt);

  /** The newest page of a thread, newest first (the service reverses it to oldest-first). */
  @Query(
      """
      SELECT m FROM ChatMessage m WHERE m.threadId = :threadId
      ORDER BY m.createdAt DESC, m.id DESC
      """)
  List<ChatMessage> findPage(@Param("threadId") UUID threadId, Limit limit);

  /** A following history page: rows strictly older than the cursor (created_at, id). */
  @Query(
      """
      SELECT m FROM ChatMessage m WHERE m.threadId = :threadId
        AND (m.createdAt < :beforeAt OR (m.createdAt = :beforeAt AND m.id < :beforeId))
      ORDER BY m.createdAt DESC, m.id DESC
      """)
  List<ChatMessage> findPageBefore(
      @Param("threadId") UUID threadId,
      @Param("beforeAt") Instant beforeAt,
      @Param("beforeId") UUID beforeId,
      Limit limit);

  /** The reconnect backfill: everything strictly newer than a message, oldest first. */
  @Query(
      """
      SELECT m FROM ChatMessage m WHERE m.threadId = :threadId
        AND (m.createdAt > :afterAt OR (m.createdAt = :afterAt AND m.id > :afterId))
      ORDER BY m.createdAt ASC, m.id ASC
      """)
  List<ChatMessage> findAfter(
      @Param("threadId") UUID threadId,
      @Param("afterAt") Instant afterAt,
      @Param("afterId") UUID afterId,
      Limit limit);

  /** Counterpart messages after the caller's read marker (CHAT-02 unread count). */
  @Query(
      """
      SELECT COUNT(m) FROM ChatMessage m WHERE m.threadId = :threadId
        AND m.senderUserId <> :callerUserId
        AND (m.createdAt > :markerAt OR (m.createdAt = :markerAt AND m.id > :markerId))
      """)
  long countUnreadAfter(
      @Param("threadId") UUID threadId,
      @Param("callerUserId") UUID callerUserId,
      @Param("markerAt") Instant markerAt,
      @Param("markerId") UUID markerId);

  /** Counterpart messages of a thread whose caller has no read marker yet. */
  long countByThreadIdAndSenderUserIdNot(UUID threadId, UUID callerUserId);
}
