package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AttachmentDto;
import com.labby.backend.dto.LocalizedTextDto;
import com.labby.backend.dto.PartySummaryDto;
import com.labby.backend.dto.RideLinkDto;
import com.labby.backend.dto.TicketCategoryDto;
import com.labby.backend.dto.TicketDto;
import com.labby.backend.dto.TicketEventDto;
import com.labby.backend.dto.TicketMessageDto;
import com.labby.backend.enums.Language;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.TicketSide;
import com.labby.backend.model.Ride;
import com.labby.backend.model.StoredFile;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.model.TicketAttachment;
import com.labby.backend.model.TicketCategory;
import com.labby.backend.model.TicketEvent;
import com.labby.backend.model.TicketMessage;
import com.labby.backend.model.User;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.StoredFileRepository;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketAttachmentRepository;
import com.labby.backend.repository.TicketCategoryRepository;
import com.labby.backend.repository.TicketMessageRepository;
import com.labby.backend.repository.UserRepository;
import com.labby.backend.repository.projection.TicketCountRow;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Builds the support-v1 views of tickets, threads and histories for both audiences, batching the
 * lookups (categories, attachments, users, rides, thread aggregates) per page.
 */
@Component
@RequiredArgsConstructor
public class SupportAssembler {

  /** The support side's display name to users (support-v1 {@code TicketMessage.senderName}). */
  static final String SUPPORT_NAME_EN = "Labby support";

  static final String SUPPORT_NAME_AR = "دعم لبي";

  private final SupportTicketRepository supportTicketRepository;
  private final TicketCategoryRepository ticketCategoryRepository;
  private final TicketAttachmentRepository ticketAttachmentRepository;
  private final TicketMessageRepository ticketMessageRepository;
  private final StoredFileRepository storedFileRepository;
  private final StorageProvider storageProvider;
  private final UserRepository userRepository;
  private final RideRepository rideRepository;
  private final Clock clock;

  /**
   * The user views of a page of tickets, in the page's order.
   *
   * @param tickets the page
   * @return the views
   */
  public List<TicketDto> tickets(List<SupportTicket> tickets) {
    Context context = context(tickets);
    return tickets.stream().map(ticket -> ticket(ticket, context)).toList();
  }

  /**
   * The user view of one ticket.
   *
   * @param ticket the ticket
   * @return the view
   */
  public TicketDto ticket(SupportTicket ticket) {
    return ticket(ticket, context(List.of(ticket)));
  }

  /**
   * The admin views of a page of tickets (queue rows), in the page's order.
   *
   * @param tickets the page
   * @return the views
   */
  public List<AdminTicketDto> adminTickets(List<SupportTicket> tickets) {
    Context context = context(tickets);
    Instant now = clock.instant();
    return tickets.stream().map(ticket -> adminTicket(ticket, context, now)).toList();
  }

  /**
   * The admin view of one ticket.
   *
   * @param ticket the ticket
   * @return the view
   */
  public AdminTicketDto adminTicket(SupportTicket ticket) {
    return adminTicket(ticket, context(List.of(ticket)), clock.instant());
  }

  /**
   * A thread as the given audience sees it: admins see admin names, users see the localized "Labby
   * support".
   *
   * @param ticket the ticket
   * @param forAdmin whether the viewer is an admin
   * @return the messages, oldest first
   */
  public List<TicketMessageDto> messages(SupportTicket ticket, boolean forAdmin) {
    List<TicketMessage> messages =
        ticketMessageRepository.findByTicketIdOrderByCreatedAtAscIdAsc(ticket.getId());
    Map<UUID, User> users =
        users(messages.stream().map(TicketMessage::getSenderUserId).collect(Collectors.toSet()));
    User owner = userRepository.findById(ticket.getUserId()).orElse(null);
    String supportName =
        owner != null && owner.getLanguage() == Language.AR ? SUPPORT_NAME_AR : SUPPORT_NAME_EN;
    return messages.stream()
        .map(
            message ->
                new TicketMessageDto(
                    message.getId(),
                    message.getTicketId(),
                    message.getSenderSide(),
                    message.getSenderSide() == TicketSide.SUPPORT && !forAdmin
                        ? supportName
                        : name(users, message.getSenderUserId()),
                    message.getBody(),
                    message.getCreatedAt()))
        .toList();
  }

  /**
   * A history as the given audience sees it: admin actor names only to admins.
   *
   * @param events the history rows, oldest first
   * @param forAdmin whether the viewer is an admin
   * @return the views
   */
  public List<TicketEventDto> events(List<TicketEvent> events, boolean forAdmin) {
    Map<UUID, User> users =
        users(
            events.stream()
                .map(TicketEvent::getActorUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    return events.stream()
        .map(
            event ->
                new TicketEventDto(
                    event.getId(),
                    event.getType(),
                    event.getActorSide(),
                    event.getActorUserId() == null
                            || (event.getActorSide() == TicketSide.SUPPORT && !forAdmin)
                        ? null
                        : name(users, event.getActorUserId()),
                    event.getFromValue(),
                    event.getToValue(),
                    event.getCreatedAt()))
        .toList();
  }

  /**
   * One party (support-v1 {@code Party}).
   *
   * @param userId the account
   * @param role the role in this context
   * @return the party, with an empty name for a missing account
   */
  public PartySummaryDto party(UUID userId, RideParty role) {
    return new PartySummaryDto(
        userId, userRepository.findById(userId).map(User::getName).orElse(""), role);
  }

  /**
   * The signed attachment views of one ticket, in upload order.
   *
   * @param ticketId the ticket
   * @return the attachments
   */
  public List<AttachmentDto> attachments(UUID ticketId) {
    return attachments(ticketAttachmentRepository.findByTicketIdOrderByPositionAsc(ticketId));
  }

  /**
   * The ride link of a ticket as its user sees it.
   *
   * @param ticket the ticket
   * @return the link, or null when the ticket names no ride
   */
  public RideLinkDto rideLink(SupportTicket ticket) {
    if (ticket.getRideId() == null) {
      return null;
    }
    Ride ride = rideRepository.findById(ticket.getRideId()).orElse(null);
    return ride == null ? null : rideLink(ticket, ride, users(counterparts(List.of(ride))));
  }

  // ---- internals -------------------------------------------------------------------------------

  /** The batched lookups of one page. */
  private record Context(
      Map<UUID, TicketCategory> categories,
      Map<UUID, List<TicketAttachment>> attachments,
      Map<UUID, StoredFile> files,
      Map<UUID, Long> unread,
      Map<UUID, Instant> lastMessageAt,
      Map<UUID, Ride> rides,
      Map<UUID, User> users) {}

  private Context context(List<SupportTicket> tickets) {
    if (tickets.isEmpty()) {
      return new Context(Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of());
    }
    List<UUID> ids = tickets.stream().map(SupportTicket::getId).toList();
    Map<UUID, TicketCategory> categories =
        ticketCategoryRepository
            .findAllById(
                tickets.stream()
                    .map(SupportTicket::getTicketCategoryId)
                    .collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(TicketCategory::getId, Function.identity()));
    Map<UUID, List<TicketAttachment>> attachments = new HashMap<>();
    for (TicketAttachment attachment :
        ticketAttachmentRepository.findByTicketIdInOrderByTicketIdAscPositionAsc(ids)) {
      attachments
          .computeIfAbsent(attachment.getTicketId(), key -> new ArrayList<>())
          .add(attachment);
    }
    Map<UUID, StoredFile> files =
        storedFileRepository
            .findAllById(
                attachments.values().stream()
                    .flatMap(List::stream)
                    .map(TicketAttachment::getStoredFileId)
                    .collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(StoredFile::getId, Function.identity()));
    Map<UUID, Long> unread =
        ticketMessageRepository.countUnreadSupportMessages(ids).stream()
            .collect(Collectors.toMap(TicketCountRow::getTicketId, TicketCountRow::getCount));
    Map<UUID, Instant> lastAt =
        ticketMessageRepository.findLastMessageAt(ids).stream()
            .collect(
                Collectors.toMap(
                    TicketMessageRepository.LastMessageRow::getTicketId,
                    TicketMessageRepository.LastMessageRow::getLastAt));
    Map<UUID, Ride> rides =
        rideRepository
            .findAllById(
                tickets.stream()
                    .map(SupportTicket::getRideId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet()))
            .stream()
            .collect(Collectors.toMap(Ride::getId, Function.identity()));
    Set<UUID> userIds = new HashSet<>(counterparts(rides.values()));
    for (SupportTicket ticket : tickets) {
      userIds.add(ticket.getUserId());
      userIds.add(ticket.getOpenedByUserId());
      if (ticket.getAssigneeUserId() != null) {
        userIds.add(ticket.getAssigneeUserId());
      }
    }
    return new Context(categories, attachments, files, unread, lastAt, rides, users(userIds));
  }

  private TicketDto ticket(SupportTicket ticket, Context context) {
    TicketCategory category = context.categories().get(ticket.getTicketCategoryId());
    Ride ride = ticket.getRideId() == null ? null : context.rides().get(ticket.getRideId());
    List<TicketAttachment> attachments =
        context.attachments().getOrDefault(ticket.getId(), List.of());
    return new TicketDto(
        ticket.getId(),
        ticket.getKind(),
        category == null ? null : category(category),
        ticket.getPriority(),
        ticket.getStatus(),
        ticket.getCaseStatus(),
        ticket.getDescription(),
        ride == null ? null : rideLink(ticket, ride, context.users()),
        attachments.stream()
            .map(attachment -> context.files().get(attachment.getStoredFileId()))
            .filter(Objects::nonNull)
            .map(this::attachment)
            .toList(),
        context.unread().getOrDefault(ticket.getId(), 0L),
        context.lastMessageAt().get(ticket.getId()),
        ticket.getCreatedAt(),
        ticket.getUpdatedAt());
  }

  private AdminTicketDto adminTicket(SupportTicket ticket, Context context, Instant now) {
    boolean openedBySupport = !ticket.getOpenedByUserId().equals(ticket.getUserId());
    return new AdminTicketDto(
        ticket(ticket, context),
        new PartySummaryDto(
            ticket.getUserId(),
            name(context.users(), ticket.getUserId()),
            userRole(ticket, context.rides().get(ticket.getRideId()))),
        new AdminTicketDto.OpenedByDto(
            ticket.getOpenedByUserId(),
            name(context.users(), ticket.getOpenedByUserId()),
            openedBySupport ? TicketSide.SUPPORT : TicketSide.USER),
        ticket.getAssigneeUserId() == null
            ? null
            : new AdminTicketDto.AssigneeDto(
                ticket.getAssigneeUserId(), name(context.users(), ticket.getAssigneeUserId())),
        ticket.getSosEventId(),
        ticket.getWaitingSince(),
        ticket.getReminderSentAt(),
        ticket.getResolvedAt(),
        ticket.getClosedAt(),
        Math.max(0, Duration.between(ticket.getCreatedAt(), now).toSeconds()));
  }

  /** The user's role on the ticket: their side of the linked ride, else rider (every account). */
  private static RideParty userRole(SupportTicket ticket, Ride ride) {
    return ride != null && ticket.getUserId().equals(ride.getDriverUserId())
        ? RideParty.DRIVER
        : RideParty.RIDER;
  }

  private static RideLinkDto rideLink(SupportTicket ticket, Ride ride, Map<UUID, User> users) {
    UUID counterpart =
        ticket.getUserId().equals(ride.getDriverUserId())
            ? ride.getRiderUserId()
            : ride.getDriverUserId();
    return new RideLinkDto(
        ride.getId(),
        ride.getKind().getValue(),
        ride.getState().getValue(),
        ride.getStartedAt(),
        counterpart == null ? "" : RideAssembler.firstName(name(users, counterpart)));
  }

  private static Set<UUID> counterparts(Iterable<Ride> rides) {
    Set<UUID> ids = new HashSet<>();
    for (Ride ride : rides) {
      ids.add(ride.getRiderUserId());
      if (ride.getDriverUserId() != null) {
        ids.add(ride.getDriverUserId());
      }
    }
    return ids;
  }

  private List<AttachmentDto> attachments(List<TicketAttachment> attachments) {
    return attachments.stream()
        .map(attachment -> storedFileRepository.findById(attachment.getStoredFileId()).orElse(null))
        .filter(Objects::nonNull)
        .map(this::attachment)
        .toList();
  }

  private AttachmentDto attachment(StoredFile file) {
    return new AttachmentDto(
        file.getId(),
        file.getContentType(),
        file.getSizeBytes(),
        storageProvider.accessUrl(file.getStorageKey(), file.getContentType()).url());
  }

  /**
   * A category's user view.
   *
   * @param category the category
   * @return the view
   */
  public static TicketCategoryDto category(TicketCategory category) {
    return new TicketCategoryDto(
        category.getId(),
        new LocalizedTextDto(category.getNameEn(), category.getNameAr()),
        category.getDefaultPriority(),
        category.getSortOrder());
  }

  private Map<UUID, User> users(Set<UUID> ids) {
    return ids.isEmpty()
        ? Map.of()
        : userRepository.findAllById(ids).stream()
            .collect(Collectors.toMap(User::getId, Function.identity()));
  }

  private static String name(Map<UUID, User> users, UUID userId) {
    User user = users.get(userId);
    return user == null ? "" : user.getName();
  }

  /**
   * Whether the user holds an open lost-item case on a ride — the chat hook's question.
   *
   * @param rideId the ride
   * @param riderUserId the rider
   * @return true while a non-closed case exists
   */
  public boolean hasOpenCase(UUID rideId, UUID riderUserId) {
    return supportTicketRepository.existsOpenCase(rideId, riderUserId);
  }
}
