package com.labby.backend.dto;

import com.labby.backend.enums.ReviewStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A driver's vehicle (DRV-03, onboarding-v1.yaml {@code Vehicle}).
 *
 * @param id the vehicle id
 * @param make the make
 * @param model the model
 * @param year the model year
 * @param color the colour
 * @param plate the normalized plate
 * @param seats passenger seats
 * @param photos 1..4 photos with fresh expiring URLs, display order
 * @param reviewStatus the review state
 * @param reviewNote change-request note or rejection reason
 * @param active whether this is the driver's single active vehicle
 * @param serviceTypes service types assigned at approval; empty before
 * @param submittedAt when the vehicle was submitted
 */
public record VehicleDto(
    UUID id,
    String make,
    String model,
    int year,
    String color,
    String plate,
    int seats,
    List<FileRefDto> photos,
    ReviewStatus reviewStatus,
    String reviewNote,
    boolean active,
    List<ServiceTypeRefDto> serviceTypes,
    Instant submittedAt) {}
