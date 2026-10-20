package com.labby.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.labby.backend.enums.CaseStatus;
import com.labby.backend.enums.ReportCategory;
import com.labby.backend.enums.ReportStatus;
import com.labby.backend.enums.TicketPriority;
import com.labby.backend.enums.TicketStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What else is filed about one ride (review V1 W15, UC-A-18 "related reports/tickets/SOS"; rides-v1
 * AdminRideRelated). Each section is present only when the caller holds the permission that guards
 * it — {@code reports} needs {@code reports:view}; {@code tickets}, {@code lostItems} and {@code
 * sos} need {@code support:view} — and absent from the JSON otherwise. Lists are newest first;
 * {@code ref} is the id's first 8 hex digits, upper-case (the apps add their own prefix). No phone
 * is served here.
 *
 * @param rideId the ride
 * @param reports the reports filed on the ride
 * @param tickets the support tickets about the ride (SOS-linked ones included)
 * @param lostItems the lost-item cases of the ride
 * @param sos the SOS events raised on the ride
 */
public record AdminRideRelatedDto(
    UUID rideId,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<Report> reports,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<Ticket> tickets,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<LostItem> lostItems,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<Sos> sos) {

  /**
   * A report on the ride (opens at {@code /admin/reports/{id}}).
   *
   * @param id the report
   * @param ref short reference
   * @param category the category
   * @param status open / substantiated / unsubstantiated
   * @param reporter who filed it, and on which side
   * @param reported who it is about
   * @param createdAt when it was filed
   */
  public record Report(
      UUID id,
      String ref,
      ReportCategory category,
      ReportStatus status,
      PartySummaryDto reporter,
      PartySummaryDto reported,
      Instant createdAt) {}

  /**
   * A support ticket about the ride (opens at {@code /admin/tickets/{id}}).
   *
   * @param id the ticket
   * @param ref short reference
   * @param categoryId the category
   * @param categoryNameEn its English name
   * @param categoryNameAr its Arabic name
   * @param summary the description's first line, at most 120 characters
   * @param status the ticket status
   * @param priority the priority
   * @param user the ticket's user and the app it was opened from
   * @param sosEventId the SOS event it is linked to, or null
   * @param createdAt when it was opened
   */
  public record Ticket(
      UUID id,
      String ref,
      UUID categoryId,
      String categoryNameEn,
      String categoryNameAr,
      String summary,
      TicketStatus status,
      TicketPriority priority,
      PartySummaryDto user,
      UUID sosEventId,
      Instant createdAt) {}

  /**
   * A lost-item case of the ride (opens at {@code /admin/tickets/{id}}, like the support queue).
   *
   * @param id the case's ticket
   * @param ref short reference
   * @param summary the description's first line, at most 120 characters
   * @param caseStatus the case status
   * @param status the ticket status
   * @param user the rider who reported it
   * @param createdAt when it was reported
   */
  public record LostItem(
      UUID id,
      String ref,
      String summary,
      CaseStatus caseStatus,
      TicketStatus status,
      PartySummaryDto user,
      Instant createdAt) {}

  /**
   * An SOS event on the ride.
   *
   * @param id the event
   * @param ref short reference
   * @param triggeredBy who raised it, and on which side
   * @param triggeredAt when
   * @param acknowledged whether an admin acknowledged it
   * @param acknowledgedAt when, or null
   * @param ticketId the support ticket linked to it, or null
   */
  public record Sos(
      UUID id,
      String ref,
      PartySummaryDto triggeredBy,
      Instant triggeredAt,
      boolean acknowledged,
      Instant acknowledgedAt,
      UUID ticketId) {}
}
