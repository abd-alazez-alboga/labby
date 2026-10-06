package com.labby.backend.dto;

import com.labby.backend.enums.ApplicationStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The applicant's view of a driver application (UC-D-03); items carry their own review notes.
 *
 * @param id the driver profile id
 * @param status the stage
 * @param submittedAt the latest (re)application time
 * @param decidedAt when it was approved/rejected, or null
 * @param rejectionReason set while rejected
 * @param personal the personal-details item
 * @param documents the application's four current documents
 * @param vehicle the application's vehicle (the active one once approved)
 * @param history the stage history, oldest first
 */
public record DriverApplicationDto(
    UUID id,
    ApplicationStatus status,
    Instant submittedAt,
    Instant decidedAt,
    String rejectionReason,
    PersonalItemDto personal,
    List<DocumentDto> documents,
    VehicleDto vehicle,
    List<ApplicationEventDto> history) {}
