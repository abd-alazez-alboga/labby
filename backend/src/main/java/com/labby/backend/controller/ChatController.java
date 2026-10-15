package com.labby.backend.controller;

import com.labby.backend.dto.ChatMessagePageDto;
import com.labby.backend.dto.ChatReadRequestDto;
import com.labby.backend.dto.ChatThreadDto;
import com.labby.backend.dto.QuickReplyDto;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ChatService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The parties' side of the per-ride chat (comms-v1.yaml Chat, CHAT-01/02, CALL-01). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Chat", description = "Per-ride chat thread, history, read markers, quick replies")
@RequiredArgsConstructor
public class ChatController {

  private final ChatService chatService;

  /**
   * The ride's chat thread (UC-S-13/14).
   *
   * @param rideId the ride
   * @return 200 with the thread; 403 not a party; 404 no thread (not accepted yet)
   */
  @GetMapping("/rides/{rideId}/chat")
  @Operation(summary = "The ride's chat thread — window state, counterpart, unread count")
  public ResponseEntity<ChatThreadDto> thread(@PathVariable UUID rideId) {
    return ResponseEntity.ok(chatService.thread(SecurityUtils.currentUserId(), rideId));
  }

  /**
   * One history page ({@code before}) or the reconnect backfill ({@code after}).
   *
   * @param rideId the ride
   * @param before the previous page's cursor
   * @param after the backfill anchor message id
   * @param size page size (1..100)
   * @return 200 with one page; 400 both cursors; 403 not a party; 404 no thread
   */
  @GetMapping("/rides/{rideId}/chat/messages")
  @Operation(summary = "Chat history page / reconnect backfill")
  public ResponseEntity<ChatMessagePageDto> messages(
      @PathVariable UUID rideId,
      @RequestParam(required = false) String before,
      @RequestParam(required = false) UUID after,
      @RequestParam(defaultValue = "50") int size) {
    return ResponseEntity.ok(
        chatService.messages(SecurityUtils.currentUserId(), rideId, before, after, size));
  }

  /**
   * Records the caller's read marker (the REST fallback for the {@code chat.read} frame).
   *
   * @param rideId the ride
   * @param request the newest read message
   * @return 204; 403 not a party; 404 no thread or the message is not in it
   */
  @PostMapping("/rides/{rideId}/chat/read")
  @Operation(summary = "Record the caller's read marker")
  public ResponseEntity<Void> read(
      @PathVariable UUID rideId, @Valid @RequestBody ChatReadRequestDto request) {
    chatService.markRead(SecurityUtils.currentUserId(), rideId, request.lastReadMessageId());
    return ResponseEntity.noContent().build();
  }

  /**
   * The localized quick-reply catalog for one side of the ride (CHAT-02, NFR-U2): that audience
   * plus {@code both}.
   *
   * @param as {@code rider} or {@code driver} — the asking app
   * @return 200 with the active entries, in sort order; 400 {@code as} missing/invalid; 403 the
   *     account lacks that role
   */
  @GetMapping("/chat/quick-replies")
  @Operation(summary = "The localized one-tap quick-reply catalog")
  public ResponseEntity<List<QuickReplyDto>> quickReplies(@RequestParam("as") String as) {
    return ResponseEntity.ok(chatService.quickReplies(SecurityUtils.currentUserId(), as));
  }
}
