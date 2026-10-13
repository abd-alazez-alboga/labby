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
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.InvalidRequestException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.ChatMessage;
import com.labby.backend.model.ChatQuickReply;
import com.labby.backend.model.ChatThread;
import com.labby.backend.model.Ride;
import com.labby.backend.model.User;
import com.labby.backend.repository.ChatMessageRepository;
import com.labby.backend.repository.ChatQuickReplyRepository;
import com.labby.backend.repository.ChatThreadRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
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
 * closed_at} / {@code reopened_until} — clients never compute it. WS errors ride on {@link
 * com.labby.backend.exception.BusinessException} codes; frames go through the {@link
 * RealtimePublisher} (after commit, every instance); the offline recipient's push through the
 * notification outbox (category {@code chat}, ride-critical while the ride is active).
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
  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final OnboardingAssembler onboardingAssembler;
  private final RealtimePublisher realtimePublisher;
  private final RealtimeSessionRegistry realtimeSessionRegistry;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  @Transactional(readOnly = true)
  public ChatThreadDto thread(UUID userId, UUID rideId) {
    Ride ride = partyRide(userId, rideId);
    RideParty caller = partyOf(ride, userId);
    ChatThread thread = requireThread(rideId);
    Instant now = clock.instant();
    ChatWindowState windowState = thread.windowState(now);
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
        counterpart(ride, caller, windowState));
  }

  @Override
  @Transactional(readOnly = true)
  public ChatMessagePageDto messages(
      UUID userId, UUID rideId, String before, UUID after, int size) {
    if (before != null && after != null) {
      throw new InvalidRequestException("Use at most one of before and after");
    }
    partyRide(userId, rideId);
    ChatThread thread = requireThread(rideId);
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
  public void markRead(UUID userId, UUID rideId, UUID lastReadMessageId) {
    Ride ride = partyRide(userId, rideId);
    RideParty caller = partyOf(ride, userId);
    ChatThread thread = requireThread(rideId);
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
    frame.put("readerRole", caller.getValue());
    frame.put("lastReadMessageId", target.getId().toString());
    realtimePublisher.publish(List.of(counterpartUserId(ride, caller)), frame);
  }

  @Override
  @Transactional(readOnly = true)
  public List<QuickReplyDto> quickReplies(UUID userId) {
    List<String> audiences = new ArrayList<>();
    audiences.add(ChatQuickReply.AUDIENCE_BOTH);
    if (roleAssignmentRepository.existsByUserIdAndRole(userId, Role.RIDER)) {
      audiences.add(RideParty.RIDER.getValue());
    }
    if (roleAssignmentRepository.existsByUserIdAndRole(userId, Role.DRIVER)) {
      audiences.add(RideParty.DRIVER.getValue());
    }
    return chatQuickReplyRepository
        .findByActiveTrueAndAudienceInOrderBySortOrderAscCodeAsc(audiences)
        .stream()
        .map(reply -> new QuickReplyDto(reply.getCode(), reply.getTextEn(), reply.getTextAr()))
        .toList();
  }

  @Override
  public ChatMessageDto send(UUID userId, SendRequest request) {
    Validated validated = validate(request);
    Ride ride = rideRepository.findById(request.rideId()).orElseThrow(ChatServiceImpl::notInRide);
    RideParty sender = partyOf(ride, userId);
    if (sender == null) {
      throw notInRide();
    }
    ChatThread thread =
        chatThreadRepository
            .findByRideId(ride.getId())
            .orElseThrow(
                () ->
                    new InvalidRequestException("The chat opens when a driver accepts the ride")
                        .withCode("chat_not_open"));
    Instant now = clock.instant();
    if (!thread.windowState(now).writable()) {
      throw new InvalidRequestException("This chat is closed").withCode("chat_closed");
    }
    Optional<ChatMessage> existing =
        chatMessageRepository.findByThreadIdAndSenderUserIdAndClientMsgId(
            thread.getId(), userId, request.clientMsgId());
    if (existing.isEmpty()) {
      // Race-safe dedup: the unique constraint decides; a loser answers with the winner's row.
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
      fanOut(ride, sender, userId, stored);
      return toDto(stored, userId);
    }
    // UC-S-13 reconnection: the resend's echo is the already-stored message — one row, no error.
    realtimePublisher.publish(List.of(userId), messageFrame(ride.getId(), existing.get(), true));
    return toDto(existing.get(), userId);
  }

  @Override
  public AdminChatLogDto adminLog(UUID adminUserId, UUID rideId, String before, int size) {
    if (!rideRepository.existsById(rideId)) {
      throw new ResourceNotFoundException("Ride not found");
    }
    ChatThread thread = requireThread(rideId);
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
        thread.windowState(clock.instant()),
        thread.getOpenedAt(),
        thread.getClosedAt(),
        toDtos(oldestFirst, null),
        nextCursor);
  }

  @Override
  public void openThread(Ride ride, Instant now) {
    if (!chatThreadRepository.existsByRideId(ride.getId())) {
      chatThreadRepository.save(ChatThread.builder().rideId(ride.getId()).openedAt(now).build());
    }
  }

  @Override
  public void closeThread(UUID rideId, Instant terminalAt) {
    chatThreadRepository
        .findByRideId(rideId)
        .filter(thread -> thread.getClosedAt() == null)
        .ifPresent(
            thread -> {
              thread.setClosedAt(terminalAt.plus(CLOSE_TAIL));
              chatThreadRepository.save(thread);
            });
  }

  // ---- send internals --------------------------------------------------------------------------

  /** A validated send: the parsed kind and its exactly-one payload. */
  private record Validated(ChatMessageKind kind, String body, String quickReplyCode) {}

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
    if (code == null || chatQuickReplyRepository.findByCodeAndActiveTrue(code).isEmpty()) {
      throw invalidMessage("Unknown quick-reply code");
    }
    return new Validated(kind, null, code);
  }

  /** The chat.message fan-out to both parties, plus the offline recipient's push (CHAT-02). */
  private void fanOut(Ride ride, RideParty sender, UUID senderUserId, ChatMessage stored) {
    UUID recipient = counterpartUserId(ride, sender);
    realtimePublisher.publish(List.of(senderUserId), messageFrame(ride.getId(), stored, true));
    realtimePublisher.publish(List.of(recipient), messageFrame(ride.getId(), stored, false));
    if (!realtimeSessionRegistry.hasOpenSocket(recipient)) {
      Map<String, Object> params = new LinkedHashMap<>();
      params.put("rideId", ride.getId().toString());
      params.put("senderName", RideAssembler.firstName(name(senderUserId)));
      params.put("recipientRole", sender.other().getValue());
      // The ride-critical ruling: active-ride chat pushes bypass a muted chat category.
      params.put("rideActive", String.valueOf(ride.isActive()));
      notificationService.queue(recipient, NotificationEvent.CHAT_MESSAGE, params);
    }
  }

  private static Map<String, Object> messageFrame(
      UUID rideId, ChatMessage message, boolean toSender) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("type", "chat.message");
    frame.put("rideId", rideId.toString());
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
    frame.put("sentAt", message.getCreatedAt().toString());
    return frame;
  }

  // ---- shared internals ------------------------------------------------------------------------

  /** The ride, 404 when unknown, 403 when the caller is neither party. */
  private Ride partyRide(UUID userId, UUID rideId) {
    Ride ride =
        rideRepository.findById(rideId).orElseThrow(() -> new ResourceNotFoundException(NO_THREAD));
    if (partyOf(ride, userId) == null) {
      throw (ForbiddenException)
          new ForbiddenException("Not a party to this ride").withCode("not_in_ride");
    }
    return ride;
  }

  private ChatThread requireThread(UUID rideId) {
    return chatThreadRepository
        .findByRideId(rideId)
        .orElseThrow(() -> new ResourceNotFoundException(NO_THREAD));
  }

  private static RideParty partyOf(Ride ride, UUID userId) {
    if (userId.equals(ride.getRiderUserId())) {
      return RideParty.RIDER;
    }
    if (userId.equals(ride.getDriverUserId())) {
      return RideParty.DRIVER;
    }
    return null;
  }

  private static UUID counterpartUserId(Ride ride, RideParty caller) {
    return caller == RideParty.RIDER ? ride.getDriverUserId() : ride.getRiderUserId();
  }

  private static UUID marker(ChatThread thread, RideParty party) {
    return party == RideParty.RIDER
        ? thread.getRiderLastReadMessageId()
        : thread.getDriverLastReadMessageId();
  }

  /** CALL-01: the counterpart card; the real phone only while the window allows writes. */
  private ChatCounterpartDto counterpart(Ride ride, RideParty caller, ChatWindowState state) {
    RideParty role = caller.other();
    User user = userRepository.findById(counterpartUserId(ride, caller)).orElseThrow();
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
