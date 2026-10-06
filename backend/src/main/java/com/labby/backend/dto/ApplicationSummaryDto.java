package com.labby.backend.dto;

import com.labby.backend.enums.ApplicationStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of the application queue (UC-A-10).
 *
 * @param id the driver profile id
 * @param applicant the applying account
 * @param status the stage
 * @param submittedAt the latest (re)application time
 * @param plate the application vehicle's plate
 * @param duplicatePlate the plate is on another driver's active vehicle
 */
public record ApplicationSummaryDto(
    UUID id,
    ApplicantDto applicant,
    ApplicationStatus status,
    Instant submittedAt,
    String plate,
    boolean duplicatePlate) {}
