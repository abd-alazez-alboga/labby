package com.labby.backend.controller;

import com.labby.backend.dto.AdminTicketDetailDto;
import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTicketPageDto;
import com.labby.backend.dto.PostMessageRequestDto;
import com.labby.backend.dto.TicketAssigneeRequestDto;
import com.labby.backend.dto.TicketMessageDto;
import com.labby.backend.dto.TicketPriorityRequestDto;
import com.labby.backend.dto.TicketStatusRequestDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SupportTicketService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The admin ticket queue (support-v1.yaml AdminTickets: SUP-02/03, UC-A-21). */
@RestController
@RequestMapping("/api/v1/admin/tickets")
@Tag(name = "AdminTickets", description = "Ticket queue, thread, state controls")
@RequiredArgsConstructor
public class AdminTicketsController {

  private final SupportTicketService supportTicketService;

  /**
   * The queue: priority first, then age; default every non-closed ticket.
   *
   * @return 200 with one page
   */
  @GetMapping
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Ticket queue (UC-A-21)")
  public ResponseEntity<AdminTicketPageDto> queue(
      @RequestParam(required = false) String kind,
      @RequestParam(required = false) List<String> status,
      @RequestParam(required = false) String priority,
      @RequestParam(required = false) UUID categoryId,
      @RequestParam(required = false) UUID assigneeUserId,
      @RequestParam(required = false) Boolean unassigned,
      @RequestParam(required = false) UUID userId,
      @RequestParam(required = false) UUID rideId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        supportTicketService.adminQueue(
            AdminListFilters.tickets(
                kind, status, priority, categoryId, assigneeUserId, unassigned, userId, rideId),
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /**
   * One ticket with thread, history, attachments, user and ride; the user's phone only for {@code
   * support:handle} holders.
   *
   * @param ticketId the ticket
   * @param authentication the caller
   * @return 200 with the detail; 404 unknown
   */
  @GetMapping("/{ticketId}")
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Ticket detail")
  public ResponseEntity<AdminTicketDetailDto> detail(
      @PathVariable UUID ticketId, Authentication authentication) {
    AdminTicketDetailDto detail = supportTicketService.adminDetail(ticketId);
    return ResponseEntity.ok(
        SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue())
            ? detail
            : detail.withoutPhone());
  }

  /**
   * Replies to the user (audited).
   *
   * @return 201 with the message; 404 unknown; 409 ticket_closed
   */
  @PostMapping("/{ticketId}/messages")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Reply to the user")
  public ResponseEntity<TicketMessageDto> reply(
      @PathVariable UUID ticketId, @Valid @RequestBody PostMessageRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            supportTicketService.adminReply(
                SecurityUtils.currentUserId(), ticketId, request.body()));
  }

  /**
   * Moves a plain ticket's status (audited; the user notified).
   *
   * @return 200 with the ticket; 404 unknown; 409 invalid_transition / use_case_status
   */
  @PostMapping("/{ticketId}/status")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Move a ticket's status (SUP-02)")
  public ResponseEntity<AdminTicketDto> status(
      @PathVariable UUID ticketId, @Valid @RequestBody TicketStatusRequestDto request) {
    return ResponseEntity.ok(
        supportTicketService.setStatus(SecurityUtils.currentUserId(), ticketId, request.status()));
  }

  /**
   * Overrides the priority (audited).
   *
   * @return 200 with the ticket; 404 unknown; 409 ticket_closed
   */
  @PostMapping("/{ticketId}/priority")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Override a ticket's priority (SUP-03)")
  public ResponseEntity<AdminTicketDto> priority(
      @PathVariable UUID ticketId, @Valid @RequestBody TicketPriorityRequestDto request) {
    return ResponseEntity.ok(
        supportTicketService.setPriority(
            SecurityUtils.currentUserId(), ticketId, request.priority()));
  }

  /**
   * Assigns (or unassigns with null) a handling admin (audited).
   *
   * @return 200 with the ticket; 404 unknown; 409 ticket_closed; 422 assignee_not_handler
   */
  @PostMapping("/{ticketId}/assignee")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Assign a handling admin")
  public ResponseEntity<AdminTicketDto> assignee(
      @PathVariable UUID ticketId, @RequestBody TicketAssigneeRequestDto request) {
    return ResponseEntity.ok(
        supportTicketService.assign(
            SecurityUtils.currentUserId(), ticketId, request.assigneeUserId()));
  }
}
