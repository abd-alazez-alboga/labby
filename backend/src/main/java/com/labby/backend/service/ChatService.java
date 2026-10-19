package com.labby.backend.service;

import com.labby.backend.dto.AdminChatLogDto;
import com.labby.backend.dto.ChatMessageDto;
import com.labby.backend.dto.ChatMessagePageDto;
import com.labby.backend.dto.ChatThreadDto;
import com.labby.backend.dto.QuickReplyDto;
import com.labby.backend.enums.ChatWindowState;
import com.labby.backend.model.ChatThread;
import com.labby.backend.model.Ride;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Per-ride chat (CHAT-01..03, comms-v1.yaml; per member on a shared ride, scheduled-shared-v1 — the
 * driver addresses a member's thread with {@code memberId}, required there, ignored for riders and
 * on one-rider rides): the thread view with its derived window state, the history / backfill pages,
 * read markers, the quick-reply catalog, the WS send path, the admin read-only log, and the thread
 * lifecycle hooks the ride transitions call.
 */
public interface ChatService {

  /**
   * The ride's thread as the calling party sees it (UC-S-13/14). {@code counterpart.phone} is
   * non-null only while writes are allowed (CALL-01).
   *
   * @param userId the calling party
   * @param rideId the ride
   * @param memberId the driver's addressed member (shared rides)
   * @return the thread
   */
  ChatThreadDto thread(UUID userId, UUID rideId, UUID memberId);

  /**
   * One history page ({@code before}, backwards) or the reconnect backfill ({@code after},
   * forwards) — at most one of the two.
   *
   * @param userId the calling party
   * @param rideId the ride
   * @param before the previous page's cursor, or null
   * @param after the backfill anchor message id, or null
   * @param size page size (clamped to 1..100)
   * @param memberId the driver's addressed member (shared rides)
   * @return one page, oldest first within the page
   */
  ChatMessagePageDto messages(
      UUID userId, UUID rideId, String before, UUID after, int size, UUID memberId);

  /**
   * Records the caller's read marker (idempotent; an older id than the stored one is ignored) and
   * relays a {@code chat.read} frame to the counterpart.
   *
   * @param userId the calling party
   * @param rideId the ride
   * @param lastReadMessageId the newest message the caller has read
   * @param memberId the driver's addressed member (shared rides)
   */
  void markRead(UUID userId, UUID rideId, UUID lastReadMessageId, UUID memberId);

  /**
   * The active quick replies of ONE audience plus {@code both}, in sort order (CHAT-02). The app
   * says which side it is ({@code as}); every account holds the rider role, so the role set alone
   * cannot tell a driver app from a rider app.
   *
   * @param userId the caller
   * @param as {@code rider} or {@code driver}
   * @return the catalog, both languages
   * @throws com.labby.backend.exception.InvalidRequestException {@code as} missing or invalid
   * @throws com.labby.backend.exception.ForbiddenException the account lacks that role
   */
  List<QuickReplyDto> quickReplies(UUID userId, String as);

  /**
   * The WS {@code chat.send} path: validates, enforces the window, stores (deduplicated on {@code
   * uq_chat_messages_dedup} — a resend returns the already-stored message), fans the {@code
   * chat.message} frame out to both parties and queues the recipient's push when they have no live
   * socket. Failures throw a {@link com.labby.backend.exception.BusinessException} whose code is
   * the contract's WS error code ({@code chat_not_open}, {@code chat_closed}, {@code not_in_ride},
   * {@code invalid_message}).
   *
   * @param userId the sender
   * @param request the frame's fields
   * @return the stored message (the sender's echo carries {@code clientMsgId})
   */
  ChatMessageDto send(UUID userId, SendRequest request);

  /**
   * The admin read-only log (CHAT-03) — audited by the caller.
   *
   * @param adminUserId the acting admin
   * @param rideId the ride
   * @param before the previous page's cursor, or null
   * @param size page size (clamped to 1..100)
   * @param memberId the member whose thread to read — required on a shared ride
   * @return the log page plus the window facts
   */
  AdminChatLogDto adminLog(UUID adminUserId, UUID rideId, String before, int size, UUID memberId);

  /**
   * The thread's window state with the M14 lost-item hook (LOST-01): the thread's own state, or
   * {@code reopened} when it is read-only and a non-closed lost-item case of the thread's rider
   * exists on the ride — derived per request from the open-case index, never stored.
   *
   * @param thread the thread
   * @param now the moment
   * @return the window state
   */
  ChatWindowState windowState(ChatThread thread, Instant now);

  /**
   * Creates the ride's thread at acceptance (CHAT-01; before that there is no counterpart) — on a
   * shared ride one per joined member.
   *
   * @param ride the accepted ride
   * @param now the acceptance moment
   */
  void openThread(Ride ride, Instant now);

  /**
   * Stamps the window close at a post-acceptance terminal transition: {@code closed_at} = terminal
   * moment + 24 h (completion and both cancellations alike — owner ruling 2026-10-13).
   *
   * @param rideId the ended ride
   * @param terminalAt the terminal moment
   */
  void closeThread(UUID rideId, Instant terminalAt);

  /**
   * Stamps the window close of ONE member's thread when that member's ride ends early (a
   * cancellation after dispatch or a no-show): their exit + 24 h, as CHAT-01 per thread.
   *
   * @param rideId the shared ride
   * @param riderUserId the member's rider
   * @param exitAt the member's exit moment
   */
  void closeMemberThread(UUID rideId, UUID riderUserId, Instant exitAt);

  /**
   * A {@code chat.send} frame's fields.
   *
   * @param rideId the ride
   * @param clientMsgId the sender-generated dedup key
   * @param kind {@code text} or {@code quick_reply} (raw — validated by the service)
   * @param body the text, or null
   * @param quickReplyCode the catalog code, or null
   * @param memberId the driver's addressed member (shared rides), or null
   */
  record SendRequest(
      UUID rideId,
      UUID clientMsgId,
      String kind,
      String body,
      String quickReplyCode,
      UUID memberId) {}
}
