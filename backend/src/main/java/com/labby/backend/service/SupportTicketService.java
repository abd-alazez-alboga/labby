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
import com.labby.backend.enums.TicketKind;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.web.multipart.MultipartFile;

/**
 * Support tickets (SUP-01..03, UC-S-19/20, UC-A-21; support-v1.yaml): the user side (create, list,
 * thread, reply), the admin queue and its state machine, and the SOS-linked ticket (ruling 9).
 * Lost-item cases share the ticket shape but progress through {@link LostItemService}.
 */
public interface SupportTicketService {

  /**
   * Stores a ticket attachment or lost-item photo under the private-upload rules.
   *
   * @param userId the uploader
   * @param kind {@code ticket_attachment} (JPEG/PNG/PDF) or {@code lost_item_photo} (JPEG/PNG)
   * @param file the multipart file
   * @return the stored file, usable once by the uploader for a ticket of the matching kind
   */
  UploadedFileDto uploadFile(UUID userId, String kind, MultipartFile file);

  /**
   * Opens a ticket: born {@code open} with the category's default priority, the user notified.
   *
   * @param userId the caller
   * @param request category, description, optional ride link and attachments
   * @return the ticket
   */
  TicketDto create(UUID userId, CreateTicketRequestDto request);

  /**
   * The caller's tickets of both kinds, most recently updated first.
   *
   * @param userId the caller
   * @param status optional status filter
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  TicketPageDto mine(UUID userId, TicketStatus status, int page, int size);

  /**
   * One of the caller's tickets with thread and history; stamps the user's read marker (V27).
   *
   * @param userId the caller
   * @param ticketId the ticket
   * @return the detail
   */
  TicketDetailDto detail(UUID userId, UUID ticketId);

  /**
   * The user's reply: on {@code waiting_on_user} or {@code resolved} a plain ticket moves back to
   * {@code in_progress}; closed tickets are read-only (409 {@code ticket_closed}).
   *
   * @param userId the caller
   * @param ticketId the ticket
   * @param body the message
   * @return the posted message
   */
  TicketMessageDto reply(UUID userId, UUID ticketId, String body);

  /**
   * The queue (SUP-03): priority first, then age; default = every non-closed ticket.
   *
   * @param filter the filters
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminTicketPageDto adminQueue(AdminTicketFilter filter, int page, int size);

  /**
   * One ticket with everything the handler needs — including the user's phone, which the caller
   * strips for admins without {@code support:handle}.
   *
   * @param ticketId the ticket
   * @return the detail
   */
  AdminTicketDetailDto adminDetail(UUID ticketId);

  /**
   * The support reply (audited {@code ticket.reply}): the user is notified; an {@code open} plain
   * ticket moves to {@code in_progress}.
   *
   * @param adminUserId the acting admin
   * @param ticketId the ticket
   * @param body the message
   * @return the posted message
   */
  TicketMessageDto adminReply(UUID adminUserId, UUID ticketId, String body);

  /**
   * Moves a plain ticket per the state machine (audited {@code ticket.status}; the user notified).
   *
   * @param adminUserId the acting admin
   * @param ticketId the ticket
   * @param status the target status
   * @return the ticket
   */
  AdminTicketDto setStatus(UUID adminUserId, UUID ticketId, TicketStatus status);

  /**
   * Overrides the priority (audited {@code ticket.priority}; history only, no notification).
   *
   * @param adminUserId the acting admin
   * @param ticketId the ticket
   * @param priority the new priority
   * @return the ticket
   */
  AdminTicketDto setPriority(UUID adminUserId, UUID ticketId, TicketPriority priority);

  /**
   * Assigns (or unassigns) a handling admin holding {@code support:handle} (audited {@code
   * ticket.assign}); assigning an {@code open} plain ticket moves it to {@code in_progress}.
   *
   * @param adminUserId the acting admin
   * @param ticketId the ticket
   * @param assigneeUserId the assignee, or null
   * @return the ticket
   */
  AdminTicketDto assign(UUID adminUserId, UUID ticketId, UUID assigneeUserId);

  /**
   * Opens the one linked ticket of an SOS event on the caller's behalf (audited {@code
   * sos.ticket}): {@code in_progress}, assigned to the acting admin, the caller notified.
   *
   * @param adminUserId the acting admin
   * @param sosEventId the event
   * @param request category, description, optional priority
   * @return the ticket
   */
  AdminTicketDto openSosTicket(UUID adminUserId, UUID sosEventId, SosTicketRequestDto request);

  /**
   * The queue filters (support-v1 {@code GET /admin/tickets}); every field optional.
   *
   * @param kind ticket or lost_item
   * @param statuses replaces the default "non-closed" filter when non-empty
   * @param priority exact priority
   * @param categoryId the category
   * @param assigneeUserId the assignee
   * @param unassigned true = no assignee
   * @param userId the ticket's user
   * @param rideId the linked ride
   */
  record AdminTicketFilter(
      TicketKind kind,
      List<TicketStatus> statuses,
      TicketPriority priority,
      UUID categoryId,
      UUID assigneeUserId,
      Boolean unassigned,
      UUID userId,
      UUID rideId) {}
}
