package com.labby.backend.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of the vehicle-switch queue (UC-A-11).
 *
 * @param vehicleId the switch candidate
 * @param driver the driver
 * @param make the make
 * @param model the model
 * @param plate the normalized plate
 * @param submittedAt when the switch was submitted
 * @param duplicatePlate the plate is on another driver's active vehicle
 */
public record VehicleReviewSummaryDto(
    UUID vehicleId,
    ApplicantDto driver,
    String make,
    String model,
    String plate,
    Instant submittedAt,
    boolean duplicatePlate) {}
