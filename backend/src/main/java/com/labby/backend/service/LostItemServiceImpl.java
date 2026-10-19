package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTicketPageDto;
import com.labby.backend.dto.LostItemCaseDto;
import com.labby.backend.dto.LostItemCasePageDto;
import com.labby.backend.dto.LostItemReportRequestDto;
import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.ChatWindowState;
import com.labby.backend.enums.NotificationEvent;
import com.labby.backend.enums.RideParty;
import com.labby.backend.enums.RideState;
import com.labby.backend.enums.StoredFileKind;
import com.labby.backend.enums.TicketEventType;
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketSide;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.exception.ConflictException;
import com.labby.backend.exception.ForbiddenException;
import com.labby.backend.exception.ResourceNotFoundException;
import com.labby.backend.model.ChatThread;
import com.labby.backend.model.Ride;
import com.labby.backend.model.SupportTicket;
import com.labby.backend.model.TicketCategory;
import com.labby.backend.repository.ChatThreadRepository;
import com.labby.backend.repository.RideRepository;
import com.labby.backend.repository.SupportTicketRepository;
import com.labby.backend.repository.TicketCategoryRepository;
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
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Lost-item cases (see {@link LostItemService}). */
@Service
@Transactional
@RequiredArgsConstructor
public class LostItemServiceImpl implements LostItemService {

  static final int MAX_PHOTOS = 3;

  private final SupportTicketRepository supportTicketRepository;
  private final TicketCategoryRepository ticketCategoryRepository;
  private final RideRepository rideRepository;
  private final ChatThreadRepository chatThreadRepository;
  private final RideParties rideParties;
  private final ChatService chatService;
  private final SupportTicketServiceImpl tickets;
  private final SupportAssembler assembler;
  private final TicketHistory history;
  private final NotificationService notificationService;
  private final AuditService auditService;
  private final Clock clock;

  @Override
  public LostItemCaseDto report(UUID userId, UUID rideId, LostItemReportRequestDto request) {
    Ride ride =
        rideRepository
            .findById(rideId)
            .orElseThrow(() -> new ResourceNotFoundException("Ride not found"));
    RideParty side = rideParties.sideOf(ride, userId, RideParties.RIDING);
    if (side != RideParty.RIDER) {
      throw new ForbiddenException("Only the rider of this ride can report a lost item");
    }
    if (ride.getState() != RideState.COMPLETED
        || rideParties.sideOf(ride, userId, RideParties.COMPLETED) != RideParty.RIDER) {
      throw SupportTicketServiceImpl.conflict(
          "Lost items are reported on completed rides", "ride_not_completed");
    }
    if (supportTicketRepository.existsOpenCase(rideId, userId)) {
      throw caseOpen();
    }
    List<UUID> photoIds = request.photoFileIds() == null ? List.of() : request.photoFileIds();
    tickets.requireUsableFiles(userId, photoIds, StoredFileKind.LOST_ITEM_PHOTO, MAX_PHOTOS);
    TicketCategory category =
        ticketCategoryRepository.findById(TicketCategory.LOST_ITEM_CATEGORY_ID).orElseThrow();
    Instant now = clock.instant();
    SupportTicket ticket =
        SupportTicket.builder()
            .userId(userId)
            .kind(TicketKind.LOST_ITEM)
            .ticketCategoryId(category.getId())
            .priority(category.getDefaultPriority())
            .status(TicketStatus.OPEN)
            .caseStatus(CaseStatus.REPORTED)
            .description(request.description().trim())
            .rideId(rideId)
            .openedByUserId(userId)
            .createdAt(now)
            .updatedAt(now)
            .build();
    try {
      ticket = tickets.persistWithAttachments(ticket, photoIds);
    } catch (DataIntegrityViolationException ex) {
      // A concurrent report won uq_support_tickets_open_case.
      throw caseOpen();
    }
    ensureThread(ride, userId);
    history.record(ticket, TicketEventType.CREATED, TicketSide.USER, userId, null, null, now);
    notificationService.queue(
        userId,
        NotificationEvent.SUPPORT_TICKET_CREATED,
        Map.of("ticketId", ticket.getId().toString(), "kind", TicketKind.LOST_ITEM.getValue()));
    notificationService.queue(
        ride.getDriverUserId(),
        NotificationEvent.LOST_ITEM_CASE_OPENED,
        Map.of("ticketId", ticket.getId().toString()));
    return caseView(ticket, ride);
  }

  /**
   * The reporter's thread with the driver — always there on an API ride (opened at acceptance); a
   * ride without one gets a thread already closed at completion + 24 h, so the case alone decides
   * the reopen.
   */
  private void ensureThread(Ride ride, UUID riderUserId) {
    if (chatThreadRepository.existsByRideIdAndRiderUserId(ride.getId(), riderUserId)) {
      return;
    }
    Instant completedAt = ride.getCompletedAt() == null ? clock.instant() : ride.getCompletedAt();
    chatService.openThread(ride, completedAt);
    chatService.closeMemberThread(ride.getId(), riderUserId, completedAt);
  }

  @Override
  @Transactional(readOnly = true)
  public LostItemCasePageDto mine(UUID userId, boolean openOnly, int page, int size) {
    Page<SupportTicket> cases =
        supportTicketRepository.findCasesOf(userId, openOnly, PageRequest.of(page, size));
    return new LostItemCasePageDto(
        cases.getContent().stream().map(this::caseView).toList(),
        page,
        size,
        cases.getTotalElements());
  }

  @Override
  @Transactional(readOnly = true)
  public LostItemCaseDto caseOf(UUID userId, UUID ticketId) {
    return caseView(
        supportTicketRepository
            .findCaseOf(ticketId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("Lost-item case not found")));
  }

  @Override
  @Transactional(readOnly = true)
  public AdminTicketPageDto adminQueue(List<CaseStatus> caseStatuses, int page, int size) {
    Specification<SupportTicket> spec =
        (root, query, cb) -> {
          List<Predicate> predicates = new ArrayList<>();
          predicates.add(cb.equal(root.get("kind"), TicketKind.LOST_ITEM));
          if (caseStatuses == null || caseStatuses.isEmpty()) {
            predicates.add(cb.notEqual(root.get("caseStatus"), CaseStatus.CLOSED));
          } else {
            predicates.add(root.get("caseStatus").in(caseStatuses));
          }
          return cb.and(predicates.toArray(Predicate[]::new));
        };
    Page<SupportTicket> cases =
        supportTicketRepository.findAll(
            spec, PageRequest.of(page, size, SupportTicketServiceImpl.QUEUE_ORDER));
    return new AdminTicketPageDto(
        assembler.adminTickets(cases.getContent()), page, size, cases.getTotalElements());
  }

  @Override
  public AdminTicketDto setCaseStatus(UUID adminUserId, UUID ticketId, CaseStatus caseStatus) {
    SupportTicket ticket =
        supportTicketRepository
            .findById(ticketId)
            .filter(SupportTicket::isLostItem)
            .orElseThrow(() -> new ResourceNotFoundException("Lost-item case not found"));
    CaseStatus from = ticket.getCaseStatus();
    if (!from.canMoveTo(caseStatus)) {
      throw SupportTicketServiceImpl.conflict(
          "Cannot move a case from " + from.getValue() + " to " + caseStatus.getValue(),
          "invalid_transition");
    }
    Instant now = clock.instant();
    ticket.setCaseStatus(caseStatus);
    TicketStatus mirrored = caseStatus.ticketStatus();
    TicketStatus before = ticket.getStatus();
    if (before != mirrored) {
      ticket.moveTo(mirrored, now);
    }
    history.touch(ticket, now);
    history.record(
        ticket,
        TicketEventType.CASE_STATUS_CHANGED,
        TicketSide.SUPPORT,
        adminUserId,
        from.getValue(),
        caseStatus.getValue(),
        now);
    if (before != mirrored) {
      history.record(
          ticket,
          TicketEventType.STATUS_CHANGED,
          TicketSide.SUPPORT,
          adminUserId,
          before.getValue(),
          mirrored.getValue(),
          now);
    }
    Ride ride = rideRepository.findById(ticket.getRideId()).orElseThrow();
    notifyCase(ticket.getUserId(), ticket, caseStatus, RideParty.RIDER);
    notifyCase(ride.getDriverUserId(), ticket, caseStatus, RideParty.DRIVER);
    Map<String, Object> after =
        Map.of("caseStatus", caseStatus.getValue(), "status", mirrored.getValue());
    auditService.record(
        adminUserId,
        "lost_item.case_status",
        "ticket",
        ticketId.toString(),
        Map.of("caseStatus", from.getValue(), "status", before.getValue()),
        after);
    return assembler.adminTicket(ticket);
  }

  private void notifyCase(UUID userId, SupportTicket ticket, CaseStatus caseStatus, RideParty as) {
    notificationService.queue(
        userId,
        NotificationEvent.LOST_ITEM_CASE_STATUS_CHANGED,
        Map.of(
            "ticketId", ticket.getId().toString(),
            "caseStatus", caseStatus.getValue(),
            "as", as.getValue()));
  }

  private LostItemCaseDto caseView(SupportTicket ticket) {
    return caseView(ticket, rideRepository.findById(ticket.getRideId()).orElseThrow());
  }

  private LostItemCaseDto caseView(SupportTicket ticket, Ride ride) {
    ChatThread thread =
        chatThreadRepository
            .findByRideIdAndRiderUserId(ride.getId(), ticket.getUserId())
            .orElse(null);
    ChatWindowState window =
        thread == null
            ? ChatWindowState.READ_ONLY
            : chatService.windowState(thread, clock.instant());
    return new LostItemCaseDto(
        ticket.getId(),
        ticket.getCaseStatus(),
        ticket.getStatus(),
        ticket.getDescription(),
        assembler.attachments(ticket.getId()),
        assembler.rideLink(ticket),
        assembler.party(ticket.getUserId(), RideParty.RIDER),
        assembler.party(ride.getDriverUserId(), RideParty.DRIVER),
        window,
        ticket.getCreatedAt(),
        ticket.getUpdatedAt());
  }

  private static ConflictException caseOpen() {
    return SupportTicketServiceImpl.conflict(
        "You already have an open lost-item case on this ride", "lost_item_case_open");
  }
}
