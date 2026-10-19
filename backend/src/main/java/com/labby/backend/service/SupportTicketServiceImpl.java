package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketDetailDto;
import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTicketPageDto;
import com.labby.backend.dto.CreateTicketRequestDto;
import com.labby.backend.dto.SosTicketRequestDto;
import com.labby.backend.dto.TicketDetailDto;
import com.labby.backend.dto.TicketDto;
import com.labby.backend.dto.TicketMessageDto;
import com.labby.backend.dto.TicketPageDto;
import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.Permission;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.Role;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketSide;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.exception.BusinessRuleViolationException;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.ChatThread;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SharedRideMember;
import com.labby.backend.model.SosEvent;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.model.TicketCategory;
import com.labby.backend.model.TicketMessage;
import com.labby.backend.model.User;
import com.labby.backend.repository.ChatThreadRepository;
import com.labby.backend.repository.RbacPermissionRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.RoleAssignmentRepository;
import com.labby.backend.repository.SosEventRepository;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketCategoryRepository;
import com.labby.backend.repository.TicketEventRepository;
import com.labby.backend.repository.TicketMessageRepository;
import com.labby.backend.repository.UserRepository;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** The ticket workflow (see {@link SupportTicketService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class SupportTicketServiceImpl implements SupportTicketService {

  static final int MAX_ATTACHMENTS = 5;

  /** The queue order (SUP-03): most urgent first, oldest first within a priority. */
  static final Sort QUEUE_ORDER =
      Sort.by(Sort.Order.asc("priorityRank"), Sort.Order.asc("createdAt"), Sort.Order.asc("id"));

  private static final String TARGET = "ticket";

  private final SupportTicketRepository supportTicketRepository;
  private final TicketCategoryRepository ticketCategoryRepository;
  private final TicketMessageRepository ticketMessageRepository;
  private final TicketEventRepository ticketEventRepository;
  private final RideRepository rideRepository;
  private final SosEventRepository sosEventRepository;
  private final ChatThreadRepository chatThreadRepository;
  private final UserRepository userRepository;
  private final RoleAssignmentRepository roleAssignmentRepository;
  private final RbacPermissionRepository rbacPermissionRepository;
  private final RideParties rideParties;
  private final DriverFileService driverFileService;
  private final ChatService chatService;
  private final SupportAssembler assembler;
  private final TicketHistory history;
  private final TicketFiles ticketFiles;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  public UploadedFileDto uploadFile(UUID userId, String kind, MultipartFile file) {
    return driverFileService.uploadTicketFile(userId, kind, file);
  }

  @Override
  public TicketDto create(UUID userId, CreateTicketRequestDto request) {
    TicketCategory category = pickableCategory(request.categoryId());
    Role role = request.submittedAs() == RideParty.DRIVER ? Role.DRIVER : Role.RIDER;
    if (!roleAssignmentRepository.existsByUserIdAndRole(userId, role)) {
      throw new ForbiddenException(
          "This account has no " + request.submittedAs().getValue() + " role");
    }
    if (request.rideId() != null) {
      Ride ride =
          rideRepository
              .findById(request.rideId())
              .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
      if (rideParties.sideOf(ride, userId, RideParties.DISPATCHED) == null) {
        throw new ForbiddenException("Not a party to this ride");
      }
    }
    List<UUID> fileIds =
        request.attachmentFileIds() == null ? List.of() : request.attachmentFileIds();
    ticketFiles.requireUsableFiles(
        userId, fileIds, StoredFileKind.TICKET_ATTACHMENT, MAX_ATTACHMENTS);
    Instant now = clock.instant();
    SupportTicket ticket =
        SupportTicket.builder()
            .userId(userId)
            .kind(TicketKind.TICKET)
            .ticketCategoryId(category.getId())
            .priority(category.getDefaultPriority())
            .status(TicketStatus.OPEN)
            .description(request.description().trim())
            .rideId(request.rideId())
            .submittedAs(request.submittedAs())
            .openedByUserId(userId)
            .createdAt(now)
            .updatedAt(now)
            .build();
    ticket = ticketFiles.persistWithAttachments(ticket, fileIds);
    history.record(ticket, TicketEventType.CREATED, TicketSide.USER, userId, null, null, now);
    notificationService.queue(
        userId,
        NotificationEvent.SUPPORT_TICKET_CREATED,
        Map.of("ticketId", ticket.getId().toString(), "kind", TicketKind.TICKET.getValue()));
    return assembler.ticket(ticket);
  }

  /** An active, non-system category a user (or an SOS ticket) may pick. */
  public TicketCategory pickableCategory(UUID categoryId) {
    TicketCategory category =
        ticketCategoryRepository
            .findById(categoryId)
            .orElseThrow(() -> new ResourceNotFoundException("Ticket category not found"));
    if (category.isSystem()) {
      throw conflict("This category is reserved for lost-item cases", "category_reserved");
    }
    if (!category.isActive()) {
      throw conflict("This category is no longer available", "category_inactive");
    }
    return category;
  }

  @Override
  @Transactional(readOnly = true)
  public TicketPageDto mine(UUID userId, TicketStatus status, int page, int size) {
    Specification<SupportTicket> spec =
        (root, query, cb) ->
            status == null
                ? cb.equal(root.get("userId"), userId)
                : cb.and(
                    cb.equal(root.get("userId"), userId), cb.equal(root.get("status"), status));
    Page<SupportTicket> tickets =
        supportTicketRepository.findAll(
            spec,
            PageRequest.of(
                page, size, Sort.by(Sort.Order.desc("updatedAt"), Sort.Order.desc("id"))));
    return new TicketPageDto(
        assembler.tickets(tickets.getContent()), page, size, tickets.getTotalElements());
  }

  @Override
  public TicketDetailDto detail(UUID userId, UUID ticketId) {
    SupportTicket ticket = requireMine(userId, ticketId);
    List<TicketMessageDto> messages = assembler.messages(ticket, false);
    // V27: the thread view is the read; unread counts from here on. A one-column stamp, never a
    // full save: a stale thread view must not write workflow columns back (review-M14 H1).
    supportTicketRepository.stampUserRead(ticketId, clock.instant());
    return new TicketDetailDto(
        assembler.ticket(ticket),
        messages,
        assembler.events(
            ticketEventRepository.findByTicketIdOrderByCreatedAtAscSeqAsc(ticketId), false));
  }

  @Override
  public TicketMessageDto reply(UUID userId, UUID ticketId, String body) {
    SupportTicket ticket = requireMine(userId, ticketId);
    Instant now = clock.instant();
    TicketMessage message = post(ticket, userId, TicketSide.USER, body, now);
    // SUP-02 "reply to reopen discussion until closed" — plain tickets only; a case's status
    // follows the case.
    if (!ticket.isLostItem()
        && (ticket.getStatus() == TicketStatus.WAITING_ON_USER
            || ticket.getStatus() == TicketStatus.RESOLVED)) {
      history.move(ticket, TicketStatus.IN_PROGRESS, TicketSide.USER, userId, now);
    }
    return assembler.messages(ticket, false).stream()
        .filter(dto -> dto.messageId().equals(message.getId()))
        .findFirst()
        .orElseThrow();
  }

  /** Posts one message on a non-closed ticket and touches it. */
  private TicketMessage post(
      SupportTicket ticket, UUID senderUserId, TicketSide side, String body, Instant now) {
    if (ticket.isClosed()) {
      throw ticketClosed();
    }
    TicketMessage message =
        ticketMessageRepository.save(
            TicketMessage.builder()
                .ticketId(ticket.getId())
                .senderUserId(senderUserId)
                .senderSide(side)
                .body(body.trim())
                .createdAt(now)
                .build());
    history.touch(ticket, now);
    return message;
  }

  @Override
  @Transactional(readOnly = true)
  public AdminTicketPageDto adminQueue(AdminTicketFilter filter, int page, int size) {
    Page<SupportTicket> tickets =
        supportTicketRepository.findAll(queueSpec(filter), PageRequest.of(page, size, QUEUE_ORDER));
    return new AdminTicketPageDto(
        assembler.adminTickets(tickets.getContent()), page, size, tickets.getTotalElements());
  }

  private static Specification<SupportTicket> queueSpec(AdminTicketFilter filter) {
    return (root, query, cb) -> {
      List<Predicate> predicates = new ArrayList<>();
      if (filter.statuses() == null || filter.statuses().isEmpty()) {
        predicates.add(cb.notEqual(root.get("status"), TicketStatus.CLOSED));
      } else {
        predicates.add(root.get("status").in(filter.statuses()));
      }
      if (filter.kind() != null) {
        predicates.add(cb.equal(root.get("kind"), filter.kind()));
      }
      if (filter.priority() != null) {
        predicates.add(cb.equal(root.get("priority"), filter.priority()));
      }
      if (filter.categoryId() != null) {
        predicates.add(cb.equal(root.get("ticketCategoryId"), filter.categoryId()));
      }
      if (filter.assigneeUserId() != null) {
        predicates.add(cb.equal(root.get("assigneeUserId"), filter.assigneeUserId()));
      }
      if (Boolean.TRUE.equals(filter.unassigned())) {
        predicates.add(cb.isNull(root.get("assigneeUserId")));
      }
      if (filter.userId() != null) {
        predicates.add(cb.equal(root.get("userId"), filter.userId()));
      }
      if (filter.rideId() != null) {
        predicates.add(cb.equal(root.get("rideId"), filter.rideId()));
      }
      return cb.and(predicates.toArray(Predicate[]::new));
    };
  }

  @Override
  @Transactional(readOnly = true)
  public AdminTicketDetailDto adminDetail(UUID ticketId) {
    SupportTicket ticket = require(ticketId);
    User user = userRepository.findById(ticket.getUserId()).orElse(null);
    AdminTicketDetailDto.LostItemInfoDto lostItem = null;
    if (ticket.isLostItem()) {
      Ride ride = rideRepository.findById(ticket.getRideId()).orElseThrow();
      ChatThread thread =
          chatThreadRepository
              .findByRideIdAndRiderUserId(ride.getId(), ticket.getUserId())
              .orElse(null);
      lostItem =
          new AdminTicketDetailDto.LostItemInfoDto(
              assembler.party(ride.getDriverUserId(), RideParty.DRIVER),
              thread == null ? null : chatService.windowState(thread, clock.instant()),
              rideParties
                  .member(ride, ticket.getUserId(), RideParties.COMPLETED)
                  .map(SharedRideMember::getId)
                  .orElse(null));
    }
    return new AdminTicketDetailDto(
        assembler.adminTicket(ticket),
        assembler.messages(ticket, true),
        assembler.events(
            ticketEventRepository.findByTicketIdOrderByCreatedAtAscSeqAsc(ticketId), true),
        user == null ? null : user.getPhone(),
        lostItem);
  }

  @Override
  public TicketMessageDto adminReply(UUID adminUserId, UUID ticketId, String body) {
    SupportTicket ticket = require(ticketId);
    Instant now = clock.instant();
    TicketMessage message = post(ticket, adminUserId, TicketSide.SUPPORT, body, now);
    if (!ticket.isLostItem() && ticket.getStatus() == TicketStatus.OPEN) {
      history.move(ticket, TicketStatus.IN_PROGRESS, TicketSide.SUPPORT, adminUserId, now);
    }
    notificationService.queue(
        ticket.getUserId(),
        NotificationEvent.SUPPORT_TICKET_MESSAGE,
        Map.of("ticketId", ticketId.toString()));
    auditService.record(
        adminUserId,
        "ticket.reply",
        TARGET,
        ticketId.toString(),
        null,
        Map.of("messageId", message.getId().toString()));
    return assembler.messages(ticket, true).stream()
        .filter(dto -> dto.messageId().equals(message.getId()))
        .findFirst()
        .orElseThrow();
  }

  @Override
  public AdminTicketDto setStatus(UUID adminUserId, UUID ticketId, TicketStatus status) {
    SupportTicket ticket = require(ticketId);
    if (ticket.isLostItem()) {
      throw conflict("A lost-item ticket's status follows its case", "use_case_status");
    }
    TicketStatus from = ticket.getStatus();
    if (!from.canMoveTo(status)) {
      throw conflict(
          "Cannot move a ticket from " + from.getValue() + " to " + status.getValue(),
          "invalid_transition");
    }
    history.move(ticket, status, TicketSide.SUPPORT, adminUserId, clock.instant());
    auditService.record(
        adminUserId,
        "ticket.status",
        TARGET,
        ticketId.toString(),
        Map.of("status", from.getValue()),
        Map.of("status", status.getValue()));
    return assembler.adminTicket(ticket);
  }

  @Override
  public AdminTicketDto setPriority(UUID adminUserId, UUID ticketId, TicketPriority priority) {
    SupportTicket ticket = require(ticketId);
    if (ticket.isClosed()) {
      throw ticketClosed();
    }
    TicketPriority from = ticket.getPriority();
    if (from != priority) {
      Instant now = clock.instant();
      ticket.setPriority(priority);
      history.touch(ticket, now);
      history.record(
          ticket,
          TicketEventType.PRIORITY_CHANGED,
          TicketSide.SUPPORT,
          adminUserId,
          from.getValue(),
          priority.getValue(),
          now);
    }
    auditService.record(
        adminUserId,
        "ticket.priority",
        TARGET,
        ticketId.toString(),
        Map.of("priority", from.getValue()),
        Map.of("priority", priority.getValue()));
    return assembler.adminTicket(ticket);
  }

  @Override
  public AdminTicketDto assign(UUID adminUserId, UUID ticketId, UUID assigneeUserId) {
    SupportTicket ticket = require(ticketId);
    if (ticket.isClosed()) {
      throw ticketClosed();
    }
    if (assigneeUserId != null && !isHandler(assigneeUserId)) {
      throw (BusinessRuleViolationException)
          new BusinessRuleViolationException("The assignee must be an admin holding support:handle")
              .withCode("assignee_not_handler");
    }
    Instant now = clock.instant();
    UUID from = ticket.getAssigneeUserId();
    ticket.setAssigneeUserId(assigneeUserId);
    history.touch(ticket, now);
    history.record(
        ticket,
        TicketEventType.ASSIGNED,
        TicketSide.SUPPORT,
        adminUserId,
        from == null ? null : from.toString(),
        assigneeUserId == null ? null : assigneeUserId.toString(),
        now);
    if (assigneeUserId != null && !ticket.isLostItem() && ticket.getStatus() == TicketStatus.OPEN) {
      history.move(ticket, TicketStatus.IN_PROGRESS, TicketSide.SUPPORT, adminUserId, now);
    }
    auditService.record(
        adminUserId,
        "ticket.assign",
        TARGET,
        ticketId.toString(),
        Map.of("assigneeUserId", from == null ? "" : from.toString()),
        Map.of("assigneeUserId", assigneeUserId == null ? "" : assigneeUserId.toString()));
    return assembler.adminTicket(ticket);
  }

  private boolean isHandler(UUID userId) {
    return rbacPermissionRepository
        .findCodesForActiveAdmin(userId)
        .contains(Permission.SUPPORT_HANDLE.getValue());
  }

  @Override
  public AdminTicketDto openSosTicket(
      UUID adminUserId, UUID sosEventId, SosTicketRequestDto request) {
    SosEvent event =
        sosEventRepository
            .findById(sosEventId)
            .orElseThrow(() -> new ResourceNotFoundException("SOS event not found"));
    if (supportTicketRepository.findBySosEventId(sosEventId).isPresent()) {
      throw alreadyLinked();
    }
    TicketCategory category = pickableCategory(request.categoryId());
    Instant now = clock.instant();
    SupportTicket ticket =
        SupportTicket.builder()
            .userId(event.getTriggeredByUserId())
            .kind(TicketKind.TICKET)
            .ticketCategoryId(category.getId())
            .priority(
                request.priority() == null ? category.getDefaultPriority() : request.priority())
            .status(TicketStatus.IN_PROGRESS)
            .description(request.description().trim())
            .rideId(event.getRideId())
            .submittedAs(event.getTriggeredByRole())
            .assigneeUserId(adminUserId)
            .openedByUserId(adminUserId)
            .sosEventId(sosEventId)
            .createdAt(now)
            .updatedAt(now)
            .build();
    try {
      ticket = supportTicketRepository.saveAndFlush(ticket);
    } catch (DataIntegrityViolationException ex) {
      // A concurrent open won uq_support_tickets_sos_event.
      throw alreadyLinked();
    }
    history.record(
        ticket,
        TicketEventType.CREATED,
        TicketSide.SUPPORT,
        adminUserId,
        null,
        TicketStatus.IN_PROGRESS.getValue(),
        now);
    history.record(
        ticket,
        TicketEventType.ASSIGNED,
        TicketSide.SUPPORT,
        adminUserId,
        null,
        adminUserId.toString(),
        now);
    notificationService.queue(
        ticket.getUserId(),
        NotificationEvent.SUPPORT_TICKET_CREATED,
        Map.of("ticketId", ticket.getId().toString(), "kind", TicketKind.TICKET.getValue()));
    auditService.record(
        adminUserId,
        "sos.ticket",
        "sos_event",
        sosEventId.toString(),
        null,
        Map.of("ticketId", ticket.getId().toString()));
    return assembler.adminTicket(ticket);
  }

  private SupportTicket require(UUID ticketId) {
    return supportTicketRepository
        .findById(ticketId)
        .orElseThrow(() -> new ResourceNotFoundException("Ticket not found"));
  }

  private SupportTicket requireMine(UUID userId, UUID ticketId) {
    return supportTicketRepository
        .findByIdAndUserId(ticketId, userId)
        .orElseThrow(() -> new ResourceNotFoundException("Ticket not found"));
  }

  static ConflictException conflict(String message, String code) {
    return (ConflictException) new ConflictException(message).withCode(code);
  }

  static ConflictException ticketClosed() {
    return conflict("This ticket is closed", "ticket_closed");
  }

  private static ConflictException alreadyLinked() {
    return conflict("This SOS event already has its ticket", "ticket_already_linked");
  }
}
