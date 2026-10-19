package com.labby.backend.service;

import com.labby.backend.dto.AdminChatLogDto;
import com.labby.backend.dto.ChatCounterpartDto;
import com.labby.backend.dto.ChatMessageDto;
import com.labby.backend.dto.ChatMessagePageDto;
import com.labby.backend.dto.ChatThreadDto;
import com.labby.backend.dto.FileRefDto;
import com.labby.backend.dto.QuickReplyDto;
import com.labby.backend.enums.ChatMessageKind;
import com.labby.backend.enums.ChatWindowState;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideKind;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.SharedMemberStatus;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.ChatMessage;
import com.labby.backend.model.ChatQuickReply;
import com.labby.backend.model.ChatThread;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.User;
import com.labby.backend.repository.ChatMessageRepository;
import com.labby.backend.repository.ChatQuickReplyRepository;
import com.labby.backend.repository.ChatThreadRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.SharedRideMemberRepository;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.util.PageCursor;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per-ride chat (CHAT-01..03). The window is derived per request from the thread's {@code
 * closed_at} / {@code reopened_until} plus the M14 open-case index — clients never compute it. WS
 * errors ride on {@link com.labby.backend.exception.BusinessException} codes; frames go through the
 * {@link RealtimePublisher} (after commit, every instance); the recipient's push on every new
 * message through the notification outbox (category {@code chat}, ride-critical while the ride is
 * active). A thread is one ride x rider (V21): on a shared ride each member has a private thread
 * with the driver, who addresses it by {@code memberId}; server frames to the driver carry that
 * {@code memberId}.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ChatServiceImpl implements ChatService {

  /** CHAT-01: the write window survives the terminal moment by this much. */
  static final Duration CLOSE_TAIL = Duration.ofHours(24);

  static final int MAX_PAGE_SIZE = 100;

  private static final String NO_THREAD = "No chat thread for this ride";

  private final ChatThreadRepository chatThreadRepository;
  private final ChatMessageRepository chatMessageRepository;
  private final ChatQuickReplyRepository chatQuickReplyRepository;
  private final RideRepository rideRepository;
  private final SharedRideMemberRepository sharedRideMemberRepository;
  private final RideParties rideParties;
  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final SupportTicketRepository supportTicketRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final RealtimePublisher realtimePublisher;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public ChatThreadDto thread(UUID userId, UUID rideId, UUID memberId) {
    Party party = party(userId, rideId, memberId);
    RideParty caller = party.side();
    ChatThread thread = requireThread(party);
    Instant now = clock.instant();
    ChatWindowState windowState = windowState(thread, now);
    UUID marker = marker(thread, caller);
    long unread =
        marker == null
            ? chatMessageRepository.countByThreadIdAndSenderUserIdNot(thread.getId(), userId)
            : chatMessageRepository
                .findByIdAndThreadId(marker, thread.getId())
                .map(
                    read ->
                        chatMessageRepository.countUnreadAfter(
                            thread.getId(), userId, read.getCreatedAt(), read.getId()))
                .orElse(0L);
    return new ChatThreadDto(
        rideId,
        windowState,
        thread.getOpenedAt(),
        thread.getClosedAt(),
        unread,
        marker,
        marker(thread, caller.other()),
        counterpart(party, windowState));
  }

  @Override
  @Transactional(readOnly = true)
  public ChatMessagePageDto messages(
      UUID userId, UUID rideId, String before, UUID after, int size, UUID memberId) {
    if (before != null && after != null) {
      throw new InvalidRequestException("Use at most one of before and after");
    }
    ChatThread thread = requireThread(party(userId, rideId, memberId));
    int pageSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
    if (after != null) {
      // Reconnect backfill: everything newer than the anchor, oldest first (lossless with the
      // clientMsgId dedup).
      ChatMessage anchor =
          chatMessageRepository
              .findByIdAndThreadId(after, thread.getId())
              .orElseThrow(() -> new ResourceNotFoundException("No such message in this chat"));
      List<ChatMessage> newer =
          chatMessageRepository.findAfter(
              thread.getId(), anchor.getCreatedAt(), anchor.getId(), Limit.of(pageSize));
      return new ChatMessagePageDto(toDtos(newer, userId), null);
    }
    List<ChatMessage> rows;
    if (before == null) {
      rows = chatMessageRepository.findPage(thread.getId(), Limit.of(pageSize + 1));
    } else {
      PageCursor cursor = PageCursor.decode(before);
      rows =
          chatMessageRepository.findPageBefore(
              thread.getId(), cursor.createdAt(), cursor.id(), Limit.of(pageSize + 1));
    }
    boolean hasNext = rows.size() > pageSize;
    List<ChatMessage> page = hasNext ? rows.subList(0, pageSize) : rows;
    String nextCursor =
        hasNext
            ? PageCursor.encode(
                page.get(page.size() - 1).getCreatedAt(), page.get(page.size() - 1).getId())
            : null;
    // The repository returns newest first; the page is served oldest first.
    List<ChatMessage> oldestFirst = new ArrayList<>(page);
    Collections.reverse(oldestFirst);
    return new ChatMessagePageDto(toDtos(oldestFirst, userId), nextCursor);
  }

  @Override
  public void markRead(UUID userId, UUID rideId, UUID lastReadMessageId, UUID memberId) {
    Party party = party(userId, rideId, memberId);
    RideParty caller = party.side();
    ChatThread thread = requireThread(party);
    ChatMessage target =
        chatMessageRepository
            .findByIdAndThreadId(lastReadMessageId, thread.getId())
            .orElseThrow(
                () ->
                    (ResourceNotFoundException)
                        new ResourceNotFoundException("No such message in this chat")
                            .withCode("invalid_message"));
    UUID current = marker(thread, caller);
    if (current != null) {
      Optional<ChatMessage> stored =
          chatMessageRepository.findByIdAndThreadId(current, thread.getId());
      if (stored.isPresent() && !isAfter(target, stored.get())) {
        return; // Idempotent: an older (or same) id than the stored marker is ignored.
      }
    }
    if (caller == RideParty.RIDER) {
      thread.setRiderLastReadMessageId(target.getId());
    } else {
      thread.setDriverLastReadMessageId(target.getId());
    }
    chatThreadRepository.save(thread);
    // Relay the read receipt to the counterpart (comms-v1 chat.read server frame).
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.read");
    frame.put("rideId", rideId.toString());
    if (caller == RideParty.RIDER && party.memberId() != null) {
      frame.put("memberId", party.memberId().toString()); // the driver's thread key
    }
    frame.put("readerRole", caller.getValue());
    frame.put("lastReadMessageId", target.getId().toString());
    realtimePublisher.publish(List.of(party.counterpartUserId()), frame);
  }

  @Override
  @Transactional(readOnly = true)
  public List<QuickReplyDto> quickReplies(UUID userId, String as) {
    RideParty audience =
        RideParty.RIDER.getValue().equals(as)
            ? RideParty.RIDER
            : RideParty.DRIVER.getValue().equals(as) ? RideParty.DRIVER : null;
    if (audience == null) {
      throw new InvalidRequestException("as must be rider or driver");
    }
    Role role = audience == RideParty.RIDER ? Role.RIDER : Role.DRIVER;
    if (!roleAssignmentRepository.existsByUserIdAndRole(userId, role)) {
      throw new ForbiddenException("This account has no " + audience.getValue() + " role");
    }
    return chatQuickReplyRepository
        .findByActiveTrueAndAudienceInOrderBySortOrderAscCodeAsc(
            List.of(ChatQuickReply.AUDIENCE_BOTH, audience.getValue()))
        .stream()
        .map(reply -> new QuickReplyDto(reply.getCode(), reply.getTextEn(), reply.getTextAr()))
        .toList();
  }

  @Override
  public ChatMessageDto send(UUID userId, SendRequest request) {
    Validated validated = validate(request);
    Ride ride = rideRepository.findById(request.rideId()).orElseThrow(ChatServiceImpl::notInRide);
    Party party = party(ride, userId, request.memberId());
    RideParty sender = party.side();
    if (validated.quickReply() != null
        && !ChatQuickReply.AUDIENCE_BOTH.equals(validated.quickReply().getAudience())
        && !sender.getValue().equals(validated.quickReply().getAudience())) {
      // A party sends only its own audience's codes (or the shared ones).
      throw invalidMessage("This quick reply is not available to the " + sender.getValue());
    }
    ChatThread thread =
        chatThreadRepository
            .findByRideIdAndRiderUserId(ride.getId(), party.riderUserId())
            .orElseThrow(
                () ->
                    new InvalidRequestException("The chat opens when a driver accepts the ride")
                        .withCode("chat_not_open"));
    Instant now = clock.instant();
    if (!windowState(thread, now).writable()) {
      throw new InvalidRequestException("This chat is closed").withCode("chat_closed");
    }
    Optional<ChatMessage> existing =
        chatMessageRepository.findByThreadIdAndSenderUserIdAndClientMsgId(
            thread.getId(), userId, request.clientMsgId());
    if (existing.isEmpty()) {
      // Race-safe dedup: the unique constraint decides; a loser answers with the winner's row.
      int inserted =
          chatMessageRepository.insertIfAbsent(
              UUID.randomUUID(),
              thread.getId(),
              userId,
              sender.getValue(),
              validated.kind().getValue(),
              validated.body(),
              validated.quickReplyCode(),
              request.clientMsgId(),
              now);
      ChatMessage stored =
          chatMessageRepository
              .findByThreadIdAndSenderUserIdAndClientMsgId(
                  thread.getId(), userId, request.clientMsgId())
              .orElseThrow();
      if (inserted == 1) {
        fanOut(party, userId, stored);
      } else {
        // Lost a concurrent duplicate's race: the winner already fanned out — echo only.
        echo(party, userId, stored);
      }
      return toDto(stored, userId);
    }
    // UC-S-13 reconnection: the resend's echo is the already-stored message — one row, no error.
    echo(party, userId, existing.get());
    return toDto(existing.get(), userId);
  }

  /** The dedup answer: the sender's echo of the already-stored message, nothing queued. */
  private void echo(Party party, UUID senderUserId, ChatMessage stored) {
    realtimePublisher.publish(
        List.of(senderUserId),
        messageFrame(
            party.ride().getId(),
            stored,
            quickReplyOf(stored),
            true,
            party.memberIdFor(party.side())));
  }

  @Override
  public AdminChatLogDto adminLog(
      UUID adminUserId, UUID rideId, String before, int size, UUID memberId) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    UUID riderUserId =
        ride.getKind() == RideKind.SHARED
            ? rideParties.driverTarget(ride, memberId, RideParties.DISPATCHED).getRiderUserId()
            : ride.getRiderUserId();
    ChatThread thread =
        chatThreadRepository
            .findByRideIdAndRiderUserId(rideId, riderUserId)
            .orElseThrow(() -> new ResourceNotFoundException(NO_THREAD));
    auditService.record(adminUserId, "chat.view", "ride", rideId.toString(), null, null);
    int pageSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
    List<ChatMessage> rows;
    if (before == null) {
      rows = chatMessageRepository.findPage(thread.getId(), Limit.of(pageSize + 1));
    } else {
      PageCursor cursor = PageCursor.decode(before);
      rows =
          chatMessageRepository.findPageBefore(
              thread.getId(), cursor.createdAt(), cursor.id(), Limit.of(pageSize + 1));
    }
    boolean hasNext = rows.size() > pageSize;
    List<ChatMessage> page = hasNext ? rows.subList(0, pageSize) : rows;
    String nextCursor =
        hasNext
            ? PageCursor.encode(
                page.get(page.size() - 1).getCreatedAt(), page.get(page.size() - 1).getId())
            : null;
    List<ChatMessage> oldestFirst = new ArrayList<>(page);
    Collections.reverse(oldestFirst);
    return new AdminChatLogDto(
        rideId,
        windowState(thread, clock.instant()),
        thread.getOpenedAt(),
        thread.getClosedAt(),
        toDtos(oldestFirst, null),
        nextCursor);
  }

  @Override
  public ChatWindowState windowState(ChatThread thread, Instant now) {
    ChatWindowState own = thread.windowState(now);
    if (own != ChatWindowState.READ_ONLY) {
      return own;
    }
    return windowState(
        thread,
        now,
        supportTicketRepository.existsOpenCase(thread.getRideId(), thread.getRiderUserId()));
  }

  @Override
  public ChatWindowState windowState(ChatThread thread, Instant now, boolean openLostItemCase) {
    ChatWindowState own = thread.windowState(now);
    if (own != ChatWindowState.READ_ONLY) {
      return own;
    }
    // LOST-01: an open lost-item case of this rider on this ride reopens the window; closing the
    // case (uq_support_tickets_open_case gone) returns it to read-only — nothing is stored.
    return openLostItemCase ? ChatWindowState.REOPENED : ChatWindowState.READ_ONLY;
  }

  @Override
  public void openThread(Ride ride, Instant now) {
    List<UUID> riders =
        ride.getKind() == RideKind.SHARED
            ? sharedRideMemberRepository
                .findByRideIdAndStatusOrderByJoinedAtAsc(ride.getId(), SharedMemberStatus.JOINED)
                .stream()
                .map(SharedRideMember::getRiderUserId)
                .toList()
            : List.of(ride.getRiderUserId());
    for (UUID riderUserId : riders) {
      if (!chatThreadRepository.existsByRideIdAndRiderUserId(ride.getId(), riderUserId)) {
        chatThreadRepository.save(
            ChatThread.builder()
                .rideId(ride.getId())
                .riderUserId(riderUserId)
                .openedAt(now)
                .build());
      }
    }
  }

  @Override
  public void closeThread(UUID rideId, Instant terminalAt) {
    for (ChatThread thread : chatThreadRepository.findByRideId(rideId)) {
      close(thread, terminalAt);
    }
  }

  @Override
  public void closeMemberThread(UUID rideId, UUID riderUserId, Instant exitAt) {
    chatThreadRepository
        .findByRideIdAndRiderUserId(rideId, riderUserId)
        .ifPresent(thread -> close(thread, exitAt));
  }

  private void close(ChatThread thread, Instant terminalAt) {
    if (thread.getClosedAt() == null) {
      thread.setClosedAt(terminalAt.plus(CLOSE_TAIL));
      chatThreadRepository.save(thread);
    }
  }

  // ---- send internals --------------------------------------------------------------------------

  /** A validated send: the parsed kind and its exactly-one payload (with the catalog entry). */
  private record Validated(ChatMessageKind kind, String body, ChatQuickReply quickReply) {

    String quickReplyCode() {
      return quickReply == null ? null : quickReply.getCode();
    }
  }

  private Validated validate(SendRequest request) {
    if (request.rideId() == null || request.clientMsgId() == null) {
      throw invalidMessage("rideId and clientMsgId are required");
    }
    ChatMessageKind kind;
    try {
      kind = ChatMessageKind.fromValue(String.valueOf(request.kind()));
    } catch (IllegalArgumentException ex) {
      throw invalidMessage("kind must be text or quick_reply");
    }
    if (kind == ChatMessageKind.TEXT) {
      String body = request.body();
      if (body == null || body.isBlank() || body.length() > 1000) {
        throw invalidMessage("A text message carries a body of 1..1000 characters");
      }
      if (request.quickReplyCode() != null) {
        throw invalidMessage("A text message carries no quickReplyCode");
      }
      return new Validated(kind, body, null);
    }
    if (request.body() != null) {
      throw invalidMessage("A quick reply carries no body");
    }
    String code = request.quickReplyCode();
    ChatQuickReply quickReply =
        code == null ? null : chatQuickReplyRepository.findByCodeAndActiveTrue(code).orElse(null);
    if (quickReply == null) {
      throw invalidMessage("Unknown quick-reply code");
    }
    return new Validated(kind, null, quickReply);
  }

  /**
   * The chat.message fan-out to both parties, plus the recipient's push on EVERY new message
   * (CHAT-02, owner ruling 2026-10-14): both apps keep their socket open in the background, so a
   * live socket says nothing about whether the chat is on screen — the apps suppress the banner
   * themselves while that ride's chat is open.
   */
  private void fanOut(Party party, UUID senderUserId, ChatMessage stored) {
    Ride ride = party.ride();
    RideParty sender = party.side();
    UUID recipient = party.counterpartUserId();
    ChatQuickReply quickReply = quickReplyOf(stored);
    realtimePublisher.publish(
        List.of(senderUserId),
        messageFrame(ride.getId(), stored, quickReply, true, party.memberIdFor(sender)));
    realtimePublisher.publish(
        List.of(recipient),
        messageFrame(ride.getId(), stored, quickReply, false, party.memberIdFor(sender.other())));
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("rideId", ride.getId().toString());
    UUID recipientMemberId = party.memberIdFor(sender.other());
    if (recipientMemberId != null) {
      params.put("memberId", recipientMemberId.toString()); // the driver opens that thread
    }
    params.put("senderName", RideAssembler.firstName(name(senderUserId)));
    params.put("recipientRole", sender.other().getValue());
    // The ride-critical ruling: active-ride chat pushes bypass a muted chat category.
    params.put("rideActive", String.valueOf(ride.isActive()));
    notificationService.queue(recipient, NotificationEvent.CHAT_MESSAGE, params);
  }

  private ChatQuickReply quickReplyOf(ChatMessage message) {
    return message.getQuickReplyCode() == null
        ? null
        : chatQuickReplyRepository.findById(message.getQuickReplyCode()).orElse(null);
  }

  /**
   * One chat.message frame. A quick reply carries its texts in both languages: each app's own
   * catalog holds only its audience, so the counterpart's codes are unknown to it.
   */
  private static Map<String, Object> messageFrame(
      UUID rideId,
      ChatMessage message,
      ChatQuickReply quickReply,
      boolean toSender,
      UUID memberId) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.message");
    frame.put("rideId", rideId.toString());
    if (memberId != null) {
      frame.put("memberId", memberId.toString()); // frames to the driver of a shared ride
    }
    frame.put("messageId", message.getId().toString());
    if (toSender) {
      // The sender recognizes its echo (= the delivery ack) by clientMsgId.
      frame.put("clientMsgId", message.getClientMsgId().toString());
    }
    frame.put("senderRole", message.getSenderRole().getValue());
    frame.put("kind", message.getKind().getValue());
    if (message.getBody() != null) {
      frame.put("body", message.getBody());
    }
    if (message.getQuickReplyCode() != null) {
      frame.put("quickReplyCode", message.getQuickReplyCode());
    }
    if (quickReply != null) {
      Map<String, Object> texts = new LinkedHashMap<>();
      texts.put("code", quickReply.getCode());
      texts.put("textEn", quickReply.getTextEn());
      texts.put("textAr", quickReply.getTextAr());
      frame.put("quickReply", texts);
    }
    frame.put("sentAt", message.getCreatedAt().toString());
    return frame;
  }

  // ---- shared internals ------------------------------------------------------------------------

  /**
   * The caller's side of one thread.
   *
   * @param ride the ride
   * @param side the caller's side
   * @param riderUserId the thread's rider (the ride's rider, or one member's)
   * @param memberId that member on a shared ride, else null
   */
  private record Party(Ride ride, RideParty side, UUID riderUserId, UUID memberId) {

    UUID counterpartUserId() {
      return side == RideParty.RIDER ? ride.getDriverUserId() : riderUserId;
    }

    /** The {@code memberId} a frame to {@code recipient} carries: only the driver's frames. */
    UUID memberIdFor(RideParty recipient) {
      return recipient == RideParty.DRIVER ? memberId : null;
    }
  }

  /** The caller's thread side: 404 unknown ride, 403 {@code not_in_ride}. */
  private Party party(UUID userId, UUID rideId, UUID memberId) {
    Ride ride =
        rideRepository.findById(rideId).orElseThrow(() -> new ResourceNotFoundException(NO_THREAD));
    return party(ride, userId, memberId);
  }

  /**
   * The caller's thread side on a known ride. A member keeps their own thread after an early exit
   * (its window closes 24 h after it); the driver names the member on a shared ride.
   */
  private Party party(Ride ride, UUID userId, UUID memberId) {
    RideParty side = rideParties.sideOf(ride, userId, RideParties.DISPATCHED);
    if (side == null) {
      throw notInRide();
    }
    if (ride.getKind() != RideKind.SHARED) {
      return new Party(ride, side, ride.getRiderUserId(), null);
    }
    SharedRideMember member =
        side == RideParty.DRIVER
            ? rideParties.driverTarget(ride, memberId, RideParties.DISPATCHED)
            : rideParties.member(ride, userId, RideParties.DISPATCHED).orElseThrow();
    return new Party(ride, side, member.getRiderUserId(), member.getId());
  }

  private ChatThread requireThread(Party party) {
    return chatThreadRepository
        .findByRideIdAndRiderUserId(party.ride().getId(), party.riderUserId())
        .orElseThrow(() -> new ResourceNotFoundException(NO_THREAD));
  }

  private static UUID marker(ChatThread thread, RideParty party) {
    return party == RideParty.RIDER
        ? thread.getRiderLastReadMessageId()
        : thread.getDriverLastReadMessageId();
  }

  /** CALL-01: the counterpart card; the real phone only while the window allows writes. */
  private ChatCounterpartDto counterpart(Party party, ChatWindowState state) {
    RideParty role = party.side().other();
    User user = userRepository.findById(party.counterpartUserId()).orElseThrow();
    String photoUrl = null;
    if (role == RideParty.DRIVER) {
      FileRefDto photo = onboardingAssembler.profilePhoto(user);
      photoUrl = photo == null ? null : photo.url();
    }
    return new ChatCounterpartDto(
        role,
        RideAssembler.firstName(user.getName()),
        photoUrl,
        state.writable() ? user.getPhone() : null);
  }

  private static boolean isAfter(ChatMessage candidate, ChatMessage reference) {
    int byTime = candidate.getCreatedAt().compareTo(reference.getCreatedAt());
    if (byTime != 0) {
      return byTime > 0;
    }
    return candidate.getId().compareTo(reference.getId()) > 0;
  }

  /**
   * Messages as DTOs; {@code clientMsgId} only on the viewer's own messages (null viewer: none).
   */
  private List<ChatMessageDto> toDtos(List<ChatMessage> messages, UUID viewerUserId) {
    List<String> codes =
        messages.stream().map(ChatMessage::getQuickReplyCode).filter(Objects::nonNull).toList();
    Map<String, ChatQuickReply> catalog =
        codes.isEmpty()
            ? Map.of()
            : chatQuickReplyRepository.findAllById(codes).stream()
                .collect(Collectors.toMap(ChatQuickReply::getCode, Function.identity()));
    return messages.stream().map(message -> toDto(message, viewerUserId, catalog)).toList();
  }

  private ChatMessageDto toDto(ChatMessage message, UUID viewerUserId) {
    Map<String, ChatQuickReply> catalog =
        message.getQuickReplyCode() == null
            ? Map.of()
            : chatQuickReplyRepository
                .findById(message.getQuickReplyCode())
                .map(reply -> Map.of(reply.getCode(), reply))
                .orElse(Map.of());
    return toDto(message, viewerUserId, catalog);
  }

  private static ChatMessageDto toDto(
      ChatMessage message, UUID viewerUserId, Map<String, ChatQuickReply> catalog) {
    ChatQuickReply reply =
        message.getQuickReplyCode() == null ? null : catalog.get(message.getQuickReplyCode());
    return new ChatMessageDto(
        message.getId(),
        message.getSenderUserId().equals(viewerUserId) ? message.getClientMsgId() : null,
        message.getSenderRole(),
        message.getKind(),
        message.getBody(),
        reply == null
            ? null
            : new QuickReplyDto(reply.getCode(), reply.getTextEn(), reply.getTextAr()),
        message.getCreatedAt());
  }

  private String name(UUID userId) {
    return userRepository.findById(userId).map(User::getName).orElse("");
  }

  private static InvalidRequestException invalidMessage(String message) {
    return (InvalidRequestException)
        new InvalidRequestException(message).withCode("invalid_message");
  }

  private static ForbiddenException notInRide() {
    return (ForbiddenException)
        new ForbiddenException("Not a party to this ride").withCode("not_in_ride");
  }
}
