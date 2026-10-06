package com.labby.backend.service;

import com.labby.backend.dto.AdminDriverApplicationDto;
import com.labby.backend.dto.ApplicationResubmitRequestDto;
import com.labby.backend.dto.ApplicationSubmitRequestDto;
import com.labby.backend.dto.ApplicationSummaryPageDto;
import com.labby.backend.dto.ApproveRequestDto;
import com.labby.backend.dto.DriverApplicationDto;
import com.labby.backend.dto.ReasonRequestDto;
import com.labby.backend.dto.RequestChangesRequestDto;
import com.labby.backend.dto.ServiceTypeRefDto;
import java.util.List;
import java.util.UUID;

/**
 * The driver application and its review (DRV-01/02, USR-01; UC-D-01..03, UC-A-10) per
 * onboarding-v1.yaml. Every stage change writes a history row, queues a notification, and — for
 * admin decisions — an audit entry (RBAC-05).
 */
public interface DriverApplicationService {

  /**
   * The applicant's own application with history (UC-D-03).
   *
   * @param userId the applicant
   * @return the application
   * @throws com.labby.backend.exception.ResourceNotFoundException when never applied
   */
  DriverApplicationDto getOwnApplication(UUID userId);

  /**
   * Submits an application, or reapplies in full after rejection (UC-D-01, UC-D-03 A2).
   *
   * @param userId the applicant
   * @param request four documents + vehicle
   * @return the submitted application
   */
  DriverApplicationDto submit(UUID userId, ApplicationSubmitRequestDto request);

  /**
   * Resubmits exactly the flagged items (UC-D-02); the application returns to under_review.
   *
   * @param userId the applicant
   * @param request the flagged items
   * @return the application
   */
  DriverApplicationDto resubmit(UUID userId, ApplicationResubmitRequestDto request);

  /**
   * The review queue (UC-A-10), oldest submission first.
   *
   * @param statuses wire stage filter; null/empty = submitted + under_review
   * @param page zero-based page
   * @param size page size
   * @return the page
   */
  ApplicationSummaryPageDto listApplications(List<String> statuses, int page, int size);

  /**
   * The reviewer's view of one application.
   *
   * @param applicationId the driver profile id
   * @return the application
   */
  AdminDriverApplicationDto getApplication(UUID applicationId);

  /**
   * submitted → under_review.
   *
   * @param actorUserId the reviewer
   * @param applicationId the driver profile id
   * @return the application
   */
  AdminDriverApplicationDto startReview(UUID actorUserId, UUID applicationId);

  /**
   * under_review → needs_changes with per-item notes.
   *
   * @param actorUserId the reviewer
   * @param applicationId the driver profile id
   * @param request the flagged items
   * @return the application
   */
  AdminDriverApplicationDto requestChanges(
      UUID actorUserId, UUID applicationId, RequestChangesRequestDto request);

  /**
   * under_review → approved: assigns service types, activates the vehicle and the driver role.
   *
   * @param actorUserId the reviewer
   * @param applicationId the driver profile id
   * @param request the service types
   * @return the application
   */
  AdminDriverApplicationDto approve(
      UUID actorUserId, UUID applicationId, ApproveRequestDto request);

  /**
   * under_review → rejected with a reason.
   *
   * @param actorUserId the reviewer
   * @param applicationId the driver profile id
   * @param request the reason
   * @return the application
   */
  AdminDriverApplicationDto reject(UUID actorUserId, UUID applicationId, ReasonRequestDto request);

  /**
   * Service types an approval may assign: enabled types of ACTIVE regions.
   *
   * @return region-then-name sorted references
   */
  List<ServiceTypeRefDto> assignableServiceTypes();
}
