package com.labby.backend.service;

import com.labby.backend.dto.AdminTicketDto;
import com.labby.backend.dto.AdminTicketPageDto;
import com.labby.backend.dto.LostItemCaseDto;
import com.labby.backend.dto.LostItemCasePageDto;
import com.labby.backend.dto.LostItemReportRequestDto;
import com.labby.backend.enums.CaseStatus;
import java.util.List;
import java.util.UUID;

/**
 * Lost-item cases (LOST-01/02, UC-R-20, UC-D-21, UC-A-22; support-v1.yaml): a case is a ticket of
 * kind {@code lost_item} in the system category whose ticket status mirrors the case; while a case
 * is open the reporter's ride chat is {@code reopened} (the M10 hook, derived from the open-case
 * index).
 */
public interface LostItemService {

  /**
   * Reports a lost item on a completed ride: case {@code reported}, the rider and the driver
   * notified, the chat reopened.
   *
   * @param userId the rider (or completed shared-ride member)
   * @param rideId the ride
   * @param request description and up to 3 photos
   * @return the case
   */
  LostItemCaseDto report(UUID userId, UUID rideId, LostItemReportRequestDto request);

  /**
   * The caller's cases — as the reporting rider or as the driver of the ride — most recently
   * updated first.
   *
   * @param userId the caller
   * @param openOnly true = not closed
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  LostItemCasePageDto mine(UUID userId, boolean openOnly, int page, int size);

  /**
   * One case the caller is a party to.
   *
   * @param userId the caller
   * @param ticketId the case
   * @return the case
   */
  LostItemCaseDto caseOf(UUID userId, UUID ticketId);

  /**
   * The lost-item slice of the queue, same sort; default = every non-closed case.
   *
   * @param caseStatuses optional case-status filter
   * @param page zero-based page
   * @param size page size
   * @return one page
   */
  AdminTicketPageDto adminQueue(List<CaseStatus> caseStatuses, int page, int size);

  /**
   * Progresses a case per the case machine (audited {@code lost_item.case_status}): the ticket
   * status mirrors it, both parties are notified, {@code closed} returns the chat to read-only.
   *
   * @param adminUserId the acting admin
   * @param ticketId the case
   * @param caseStatus the target case status
   * @return the ticket
   */
  AdminTicketDto setCaseStatus(UUID adminUserId, UUID ticketId, CaseStatus caseStatus);
}
