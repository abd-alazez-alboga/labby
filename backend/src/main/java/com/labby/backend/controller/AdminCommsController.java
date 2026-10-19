package com.labby.backend.controller;

import com.labby.backend.dto.AdminChatLogDto;
import com.labby.backend.dto.AdminSosEventDto;
import com.labby.backend.dto.AdminSosEventPageDto;
import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.SosAcknowledgeRequestDto;
import com.labby.backend.dto.SosTicketRequestDto;
import com.labby.backend.enums.Permission;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.ChatService;
import com.labby.backend.service.SosService;
import com.labby.backend.service.SupportTicketService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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

/**
 * Admin comms & safety (comms-v1.yaml AdminComms: CHAT-03, UC-A-20) plus the SOS-linked ticket
 * (support-v1.yaml AdminSos, M14 ruling 9).
 */
@RestController
@RequestMapping("/api/v1/admin")
@Tag(name = "AdminComms", description = "Chat logs, SOS alert list and acknowledgement")
@RequiredArgsConstructor
public class AdminCommsController {

  private final ChatService chatService;
  private final SosService sosService;
  private final SupportTicketService supportTicketService;

  /**
   * The full read-only chat log of a ride (CHAT-03). Audited.
   *
   * @param rideId the ride
   * @param before the previous page's cursor
   * @param size page size (1..100)
   * @param memberId the member's thread — required on a shared ride (M12)
   * @return 200 with one page plus the window facts; 400 member_required; 404 ride / member unknown
   *     or no thread
   */
  @GetMapping("/rides/{rideId}/chat")
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "Full chat log of a ride, read-only (CHAT-03)")
  public ResponseEntity<AdminChatLogDto> chatLog(
      @PathVariable UUID rideId,
      @RequestParam(required = false) String before,
      @RequestParam(defaultValue = "50") int size,
      @RequestParam(required = false) UUID memberId) {
    return ResponseEntity.ok(
        chatService.adminLog(SecurityUtils.currentUserId(), rideId, before, size, memberId));
  }

  /**
   * The SOS alert list, newest first (UC-A-20). The callers' phones are contact access: served only
   * to {@code support:handle} holders, null for {@code support:view}-only admins.
   *
   * @param status open (default), acknowledged or all
   * @param regionId optional region filter
   * @param before the previous page's cursor
   * @param size page size (1..50)
   * @param authentication the caller
   * @return 200 with one page
   */
  @GetMapping("/sos-events")
  @PreAuthorize("hasAuthority('support:view')")
  @Operation(summary = "SOS alert list (UC-A-20)")
  public ResponseEntity<AdminSosEventPageDto> sosEvents(
      @RequestParam(defaultValue = "open") String status,
      @RequestParam(required = false) UUID regionId,
      @RequestParam(required = false) String before,
      @RequestParam(defaultValue = "20") int size,
      Authentication authentication) {
    AdminSosEventPageDto page = sosService.adminList(status, regionId, before, size);
    return ResponseEntity.ok(
        SecurityUtils.holds(authentication, Permission.SUPPORT_HANDLE.getValue())
            ? page
            : page.withoutPhones());
  }

  /**
   * Acknowledges an SOS alert (stand-down). Audited; the event's facts stay immutable (SAFE-02).
   * Gated by {@code support:handle}, so the response always carries the caller's phone.
   *
   * @param sosEventId the event
   * @param request the optional note
   * @return 200 with the acknowledged event; 404 unknown; 409 already_acknowledged
   */
  @PostMapping("/sos-events/{sosEventId}/acknowledge")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Acknowledge an SOS alert (SAFE-01)")
  public ResponseEntity<AdminSosEventDto> acknowledge(
      @PathVariable UUID sosEventId,
      @Valid @RequestBody(required = false) SosAcknowledgeRequestDto request) {
    return ResponseEntity.ok(
        sosService.acknowledge(
            SecurityUtils.currentUserId(), sosEventId, request == null ? null : request.note()));
  }

  /**
   * Opens the one linked support ticket of an SOS event on the caller's behalf (audited {@code
   * sos.ticket}): about the SOS ride, {@code in_progress}, assigned to the acting admin.
   *
   * @param sosEventId the event
   * @param request category, description, optional priority
   * @return 201 with the ticket; 404 unknown event / category; 409 ticket_already_linked /
   *     category_inactive / category_reserved
   */
  @PostMapping("/sos-events/{sosEventId}/ticket")
  @PreAuthorize("hasAuthority('support:handle')")
  @Operation(summary = "Open the linked support ticket of an SOS event (M14)")
  public ResponseEntity<AdminTicketDto> ticket(
      @PathVariable UUID sosEventId, @Valid @RequestBody SosTicketRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            supportTicketService.openSosTicket(SecurityUtils.currentUserId(), sosEventId, request));
  }
}
