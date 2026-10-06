package com.labby.backend.service;

import com.labby.backend.dto.DocumentDto;
import com.labby.backend.dto.DocumentRenewalDto;
import com.labby.backend.dto.DocumentRenewalRequestDto;
import com.labby.backend.dto.DocumentSlotDto;
import com.labby.backend.dto.ExpiryDashboardDto;
import com.labby.backend.dto.ReasonRequestDto;
import java.util.List;
import java.util.UUID;

/**
 * Approved drivers' document slots, renewals and the expiry dashboard (DRV-04, UC-D-19, UC-A-12)
 * per onboarding-v1.yaml. A renewal is a new pending row beside the approved one; approving it
 * supersedes the old row and may lift an expiry suspension.
 */
public interface DriverDocumentService {

  /**
   * The four current document slots of an approved driver.
   *
   * @param userId the driver
   * @return the slots
   */
  List<DocumentSlotDto> listSlots(UUID userId);

  /**
   * Submits a renewal of a slot (allowed while suspended for expiry).
   *
   * @param userId the driver
   * @param type the wire document type
   * @param request the renewed document
   * @return the pending renewal
   */
  DocumentDto submitRenewal(UUID userId, String type, DocumentRenewalRequestDto request);

  /**
   * The pending renewal queue, oldest first.
   *
   * @return the renewals
   */
  List<DocumentRenewalDto> listRenewals();

  /**
   * One pending renewal beside the document it replaces.
   *
   * @param documentId the renewal
   * @return the renewal
   */
  DocumentRenewalDto getRenewal(UUID documentId);

  /**
   * Approves a renewal: the previous document becomes superseded; an expiry suspension is lifted
   * once no current document is expired.
   *
   * @param actorUserId the reviewer
   * @param documentId the renewal
   * @return the renewal
   */
  DocumentRenewalDto approveRenewal(UUID actorUserId, UUID documentId);

  /**
   * Rejects a renewal with a reason; the current document stays.
   *
   * @param actorUserId the reviewer
   * @param documentId the renewal
   * @param request the reason
   * @return the renewal
   */
  DocumentRenewalDto rejectRenewal(UUID actorUserId, UUID documentId, ReasonRequestDto request);

  /**
   * The expiry dashboard: current documents expiring within the horizon, and already expired.
   *
   * @param horizonDays 1..30
   * @return the dashboard
   */
  ExpiryDashboardDto expiryDashboard(int horizonDays);
}
