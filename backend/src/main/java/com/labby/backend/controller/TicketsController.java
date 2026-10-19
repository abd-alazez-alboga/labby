package com.labby.backend.controller;

import com.labby.backend.dto.CreateTicketRequestDto;
import com.labby.backend.dto.PostMessageRequestDto;
import com.labby.backend.dto.TicketCategoryDto;
import com.labby.backend.dto.TicketDetailDto;
import com.labby.backend.dto.TicketDto;
import com.labby.backend.dto.TicketMessageDto;
import com.labby.backend.dto.TicketPageDto;
import com.labby.backend.dto.UploadedFileDto;
import com.labby.backend.enums.TicketStatus;
import com.labby.backend.security.SecurityUtils;
import com.labby.backend.service.SupportTicketService;
import com.labby.backend.service.TicketCategoryService;
import com.labby.backend.util.WireEnums;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Support tickets for both apps (support-v1.yaml Tickets: SUP-01..03, UC-S-19/20). */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Tickets", description = "Open and follow support tickets")
@RequiredArgsConstructor
public class TicketsController {

  private final SupportTicketService supportTicketService;
  private final TicketCategoryService ticketCategoryService;

  /**
   * The active ticket categories a user may pick (never the system lost-item one).
   *
   * @return 200 with the list in order
   */
  @GetMapping("/support/ticket-categories")
  @Operation(summary = "Pickable ticket categories (SUP-01)")
  public ResponseEntity<List<TicketCategoryDto>> categories() {
    return ResponseEntity.ok(ticketCategoryService.userList());
  }

  /**
   * Uploads a ticket attachment (JPEG/PNG/PDF) or lost-item photo (JPEG/PNG).
   *
   * @param kind ticket_attachment or lost_item_photo
   * @param file the multipart file
   * @return 201 with the stored file; 400 empty / unsupported / unknown kind; 413 too large; 429
   *     daily cap
   */
  @PostMapping(path = "/ticket-files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(summary = "Upload a ticket attachment or lost-item photo")
  public ResponseEntity<UploadedFileDto> upload(
      @RequestParam(value = "kind", required = false) String kind,
      @RequestParam(value = "file", required = false) MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(supportTicketService.uploadFile(SecurityUtils.currentUserId(), kind, file));
  }

  /**
   * Opens a ticket.
   *
   * @param request category, description, optional ride and attachments
   * @return 201 with the ticket; 400 attachments; 403 not a party to the ride; 404 category / ride;
   *     409 category_inactive / category_reserved
   */
  @PostMapping("/tickets")
  @Operation(summary = "Open a support ticket (UC-S-19)")
  public ResponseEntity<TicketDto> create(@Valid @RequestBody CreateTicketRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(supportTicketService.create(SecurityUtils.currentUserId(), request));
  }

  /**
   * The caller's tickets, both kinds, most recently updated first.
   *
   * @param status optional status filter
   * @param page zero-based page
   * @param size page size (1..50)
   * @return 200 with one page
   */
  @GetMapping("/tickets")
  @Operation(summary = "My tickets (UC-S-20)")
  public ResponseEntity<TicketPageDto> mine(
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(
        supportTicketService.mine(
            SecurityUtils.currentUserId(),
            WireEnums.parse(TicketStatus::fromValue, status, "status"),
            Math.max(0, page),
            Math.clamp(size, 1, 50)));
  }

  /**
   * One of the caller's tickets with thread and history; marks the thread read.
   *
   * @param ticketId the ticket
   * @return 200 with the detail; 404 unknown or not mine
   */
  @GetMapping("/tickets/{ticketId}")
  @Operation(summary = "One of my tickets with thread and history")
  public ResponseEntity<TicketDetailDto> detail(@PathVariable UUID ticketId) {
    return ResponseEntity.ok(supportTicketService.detail(SecurityUtils.currentUserId(), ticketId));
  }

  /**
   * Replies in the thread; reopens the discussion on waiting_on_user / resolved.
   *
   * @param ticketId the ticket
   * @param request the body
   * @return 201 with the message; 404 unknown or not mine; 409 ticket_closed
   */
  @PostMapping("/tickets/{ticketId}/messages")
  @Operation(summary = "Reply in my ticket's thread")
  public ResponseEntity<TicketMessageDto> reply(
      @PathVariable UUID ticketId, @Valid @RequestBody PostMessageRequestDto request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(supportTicketService.reply(SecurityUtils.currentUserId(), ticketId, request.body()));
  }
}
